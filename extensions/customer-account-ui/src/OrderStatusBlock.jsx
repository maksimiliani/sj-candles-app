import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect} from 'preact/hooks';
import {useNavigation} from '@shopify/ui-extensions/customer-account/preact';

const MEDITATIONS_URL = 'https://sjcandles.com/pages/my-meditations';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const navigation = useNavigation();

  useEffect(() => {
    if (!navigation || typeof navigation.navigate !== 'function') {
      return;
    }
    navigation.navigate(MEDITATIONS_URL, {history: 'replace'});
  }, [navigation]);

  return (
    <s-banner tone="info">
      <s-text>Redirecting you to the Meditations page...</s-text>
      <s-button slot="primary-action" variant="primary" href={MEDITATIONS_URL}>
        Go to Meditations
      </s-button>
    </s-banner>
  );
}
