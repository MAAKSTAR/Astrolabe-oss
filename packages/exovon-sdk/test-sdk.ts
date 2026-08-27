import { ExovonClient, ExovonAuthError } from './src';

async function runTest() {
  console.log("🚀 Testing @exovon/sdk...");

  // 1. Initialize the client with the custom domain
  const client = new ExovonClient({
    apiKey: 'exo_live_invalid_test_key_123',
    // Point to a public mock API that returns a 401 Unauthorized
    baseUrl: 'https://httpstat.us'
  });

  try {
    console.log("Attempting to connect with invalid key...");
    await client.request('/401');
    console.error("❌ Test Failed: Expected an ExovonAuthError to be thrown!");
  } catch (error: any) {
    if (error instanceof ExovonAuthError) {
      console.log("✅ Test Passed: Caught ExovonAuthError with message:", error.message);
    } else {
      console.error("❌ Test Failed: Caught wrong error type:", error);
    }
  }
}

runTest();
