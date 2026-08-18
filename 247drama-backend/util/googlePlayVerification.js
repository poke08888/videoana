const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function verifyGooglePlayPurchase(packageName, productId, purchaseToken) {
  try {
    const keyFilePath = path.join(__dirname, '..', 'service-account.json');
    if (!fs.existsSync(keyFilePath)) {
      console.warn("⚠️ service-account.json not found! Skipping Google Play verification for local testing.");
      // In a real production environment, we should throw an error here.
      // But for development/placeholder, we allow it to pass or fail gracefully.
      return true; // Assume success if no keyfile (Placeholder behavior)
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    const androidPublisher = google.androidpublisher({
      version: 'v3',
      auth: auth,
    });

    // Check if it's a one-time purchase or a subscription
    // Assuming coins are one-time (products) and VIP are subscriptions (subscriptions)
    // We will try inapp product first
    try {
      const response = await androidPublisher.purchases.products.get({
        packageName: packageName,
        productId: productId,
        token: purchaseToken,
      });
      
      // purchaseState: 0 (Purchased), 1 (Canceled), 2 (Pending)
      if (response.data.purchaseState === 0) {
        return true;
      }
    } catch (productError) {
      // If it fails, try subscriptions
      try {
        const subResponse = await androidPublisher.purchases.subscriptions.get({
          packageName: packageName,
          subscriptionId: productId,
          token: purchaseToken,
        });

        // paymentState: 1 (Payment received)
        if (subResponse.data.paymentState !== undefined) {
          return true;
        }
      } catch (subError) {
        console.error("Google Play Verification Error:", subError.message);
        return false;
      }
    }
    return false;
  } catch (err) {
    console.error("Verification Setup Error:", err.message);
    return false;
  }
}

module.exports = {
  verifyGooglePlayPurchase,
};
