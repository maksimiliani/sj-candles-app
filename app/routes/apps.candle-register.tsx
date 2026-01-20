import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

type ProductInfo = {
  id: string;
  title: string;
  handle: string;
  variantId: string;
  qrCode: string;
};

type CustomerInfo = {
  id: string;
  email: string;
};

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return value.trim();
}

function buildReturnUrl(shop: string, path: string) {
  const base = `https://${shop}`;
  try {
    return new URL(path, base);
  } catch {
    return new URL("/", base);
  }
}

function appendError(returnUrl: URL, code: string) {
  returnUrl.searchParams.set("register_error", code);
  return returnUrl.toString();
}

function buildCustomerNote(params: {
  productTitle: string;
  productHandle: string;
  purchaseLocation: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
}) {
  const lines: string[] = [];
  lines.push(`Candle: ${params.productTitle}`);
  lines.push(`Handle: ${params.productHandle}`);
  if (params.purchaseLocation) {
    lines.push("Where purchased:");
    lines.push(params.purchaseLocation);
  }
  if (params.address1 || params.city || params.state || params.zip) {
    lines.push("Address:");
    if (params.address1) lines.push(params.address1);
    if (params.address2) lines.push(params.address2);
    const cityLine = [params.city, params.state, params.zip]
      .filter(Boolean)
      .join(", ");
    if (cityLine) lines.push(cityLine);
  }
  return lines.join("\n");
}

async function fetchProduct(admin: any, handle: string): Promise<ProductInfo | null> {
  const response = await admin.graphql(
    `#graphql
      query ProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          handle
          variants(first: 1) {
            nodes {
              id
            }
          }
          metafield(namespace: "custom", key: "qr_register_code") {
            value
          }
        }
      }`,
    {
      variables: { handle },
    },
  );

  const responseJson = await response.json();
  const product = responseJson?.data?.productByHandle;
  if (!product || !product.variants?.nodes?.length) return null;

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    variantId: product.variants.nodes[0].id,
    qrCode: (product.metafield?.value || "").trim(),
  };
}

async function findCustomerByEmail(admin: any, email: string): Promise<CustomerInfo | null> {
  const response = await admin.graphql(
    `#graphql
      query CustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          nodes {
            id
            email
          }
        }
      }`,
    {
      variables: { query: `email:${email}` },
    },
  );

  const responseJson = await response.json();
  const customer = responseJson?.data?.customers?.nodes?.[0];
  if (!customer) return null;

  return { id: customer.id, email: customer.email };
}

async function createCustomer(admin: any, params: {
  email: string;
  firstName: string;
  lastName: string;
  note: string;
}): Promise<CustomerInfo> {
  const response = await admin.graphql(
    `#graphql
      mutation CustomerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        input: {
          email: params.email,
          firstName: params.firstName,
          lastName: params.lastName,
          note: params.note,
        },
      },
    },
  );

  const responseJson = await response.json();
  const userErrors = responseJson?.data?.customerCreate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors[0].message || "Customer create failed");
  }
  const customer = responseJson?.data?.customerCreate?.customer;
  if (!customer) {
    throw new Error("Customer create failed");
  }

  return { id: customer.id, email: customer.email };
}

async function createOrder(admin: any, params: {
  email: string;
  customerId: string;
  variantId: string;
  note: string;
}) {
  const response = await admin.graphql(
    `#graphql
      mutation OrderCreate($order: OrderCreateOrderInput!) {
        orderCreate(order: $order) {
          order {
            id
            legacyResourceId
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        order: {
          email: params.email,
          customerId: params.customerId,
          lineItems: [{ variantId: params.variantId, quantity: 1 }],
          financialStatus: "PAID",
          note: params.note,
        },
      },
    },
  );

  const responseJson = await response.json();
  const userErrors = responseJson?.data?.orderCreate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors[0].message || "Order create failed");
  }

  const order = responseJson?.data?.orderCreate?.order;
  if (!order) {
    throw new Error("Order create failed");
  }

  return order;
}

async function fulfillOrder(admin: any, orderId: string) {
  const response = await admin.graphql(
    `#graphql
      query OrderFulfillmentOrders($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 10) {
            nodes {
              id
              lineItems(first: 50) {
                nodes {
                  id
                  quantity
                }
              }
            }
          }
        }
      }`,
    { variables: { id: orderId } },
  );

  const responseJson = await response.json();
  const fulfillmentOrders = responseJson?.data?.order?.fulfillmentOrders?.nodes || [];
  if (!fulfillmentOrders.length) return;

  for (const fulfillmentOrder of fulfillmentOrders) {
    const lineItems = fulfillmentOrder.lineItems.nodes.map((item: any) => ({
      id: item.id,
      quantity: item.quantity,
    }));
    if (!lineItems.length) continue;

    const fulfillmentResponse = await admin.graphql(
      `#graphql
        mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreateV2(fulfillment: $fulfillment) {
            fulfillment {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          fulfillment: {
            notifyCustomer: false,
            lineItemsByFulfillmentOrder: [
              {
                fulfillmentOrderId: fulfillmentOrder.id,
                fulfillmentOrderLineItems: lineItems,
              },
            ],
          },
        },
      },
    );

    const fulfillmentJson = await fulfillmentResponse.json();
    const errors = fulfillmentJson?.data?.fulfillmentCreateV2?.userErrors || [];
    if (errors.length) {
      throw new Error(errors[0].message || "Fulfillment failed");
    }
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return new Response("OK", { status: 200 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response("Missing shop", { status: 400 });
  }

  const formData = await request.formData();
  const productHandle = getString(formData, "product_handle");
  const productCode = getString(formData, "product_code");
  const returnTo = getString(formData, "return_to") || `/pages/community-${productHandle}`;
  const email = getString(formData, "email");
  const firstName = getString(formData, "first_name");
  const lastName = getString(formData, "last_name");
  const purchaseLocation = getString(formData, "purchase_location");
  const address1 = getString(formData, "address1");
  const address2 = getString(formData, "address2");
  const city = getString(formData, "city");
  const state = getString(formData, "state");
  const zip = getString(formData, "zip");

  const returnUrl = buildReturnUrl(shop, returnTo);

  if (!productHandle || !productCode || !email || !purchaseLocation) {
    return redirect(appendError(returnUrl, "missing_fields"));
  }

  if (formData.has("address1") && (!address1 || !city || !state || !zip)) {
    return redirect(appendError(returnUrl, "missing_fields"));
  }

  const product = await fetchProduct(admin, productHandle);
  if (!product || !product.qrCode || product.qrCode !== productCode) {
    return redirect(appendError(returnUrl, "invalid_code"));
  }

  const note = buildCustomerNote({
    productTitle: product.title,
    productHandle,
    purchaseLocation,
    address1,
    address2,
    city,
    state,
    zip,
  });

  try {
    let customer = await findCustomerByEmail(admin, email);
    if (!customer) {
      customer = await createCustomer(admin, {
        email,
        firstName,
        lastName,
        note,
      });
    }

    const order = await createOrder(admin, {
      email,
      customerId: customer.id,
      variantId: product.variantId,
      note,
    });

    await fulfillOrder(admin, order.id);
  } catch (error) {
    return redirect(appendError(returnUrl, "server_error"));
  }

  const successUrl = buildReturnUrl(
    shop,
    `/pages/my-meditations?candle=${encodeURIComponent(productHandle)}`,
  );
  return redirect(successUrl.toString());
};
