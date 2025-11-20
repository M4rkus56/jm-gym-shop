require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const paypal = require("@paypal/checkout-server-sdk");

const app = express();

// --- PAYPAL SETUP (Sandbox / Testmodus) ---
const Environment = paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

app.use(express.static("public"));
app.use(express.json());
app.use(cors());

// 1. Config an Frontend senden
app.get("/config", (req, res) => {
  res.send({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

// 2. Stripe Payment Intent (Vorbereitung)
app.post("/create-payment-intent", async (req, res) => {
  const { amount } = req.body;
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      currency: "eur",
      amount: Math.round(amount * 100),
      automatic_payment_methods: { enabled: true },
    });
    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (e) {
    res.status(400).send({ error: { message: e.message } });
  }
});

// 3. PayPal Order erstellen
app.post("/create-paypal-order", async (req, res) => {
  const { amount } = req.body;
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{
        amount: {
          currency_code: "EUR",
          value: amount.toFixed(2) // PayPal braucht String "49.90"
        }
      }]
  });

  try {
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. PayPal Zahlung abschließen (Geld einziehen)
app.post("/capture-paypal-order", async (req, res) => {
  const { orderID } = req.body;
  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await paypalClient.execute(request);
    res.json({ status: "success", details: capture.result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));