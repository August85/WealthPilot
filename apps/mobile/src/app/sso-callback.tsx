import { Redirect } from 'expo-router';

/** OAuth redirect target (wealthpilot://sso-callback). Clerk completes the session; go home. */
export default function SsoCallback() {
  return <Redirect href="/" />;
}
