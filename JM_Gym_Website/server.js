require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require('fs'); // Wichtig für den Datei-Check
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const paypal = require("@paypal/checkout-server-sdk");

const app = express();

// --- 1. DIAGNOSE & PFAD SETUP ---
// Wir definieren den Pfad zum neuen Ordner 'frontend'
const publicPath = path.join(__dirname, 'frontend');

console.log("--- SERVER START CHECK ---");
console.log("Hauptverzeichnis:", __dirname);
try {
    console.log("Dateien im Hauptordner:", fs.readdirSync(__dirname));
    console.log("Suche nach Frontend in:", publicPath);
    console.log("Dateien im Frontend-Ordner:", fs.readdirSync(publicPath));
} catch (e) {
    console.error("KRITISCHER FEHLER: Der Ordner 'frontend' existiert nicht oder ist leer!", e.message);
}
console.log("--------------------------");

// --- 2. DATENBANK VERBINDEN ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB verbunden!"))
    .catch(err => console.error("❌ MongoDB Fehler:", err));

// --- 3. BENUTZER MODELL ---
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

// --- 4. PAYPAL CONFIG ---
const Environment = paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// --- 5. MIDDLEWARE ---
app.use(express.json());
app.use(cors());

// Statische Dateien aus dem Ordner 'frontend' laden
app.use(express.static(publicPath));

// --- WICHTIG: ROUTE FÜR DIE STARTSEITE ---
app.get("/", (req, res) => {
    const indexPath = path.join(publicPath, "index.html");
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error("Fehler beim Senden der index.html:", err);
            res.status(500).send("Server Fehler: index.html nicht gefunden in " + publicPath);
        }
    });
});


// --- 6. AUTH ROUTEN ---
app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "E-Mail vergeben." });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: "Benutzer erstellt!" });
    } catch (error) { res.status(500).json({ message: "Fehler." }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "User nicht gefunden." });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Falsches Passwort." });
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ token, email: user.email });
    } catch (error) { res.status(500).json({ message: "Login Fehler" }); }
});

// --- 7. PAYMENT ROUTEN ---
app.get("/config", (req, res) => {
  res.send({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post("/create-payment-intent", async (req, res) => {
  const { amount } = req.body;
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      currency: "eur",
      amount: Math.round(amount * 100),
      automatic_payment_methods: { enabled: true },
    });
    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (e) { res.status(400).send({ error: { message: e.message } }); }
});

app.post("/create-paypal-order", async (req, res) => {
  const { amount } = req.body;
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "EUR", value: amount.toFixed(2) } }]
  });
  try {
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/capture-paypal-order", async (req, res) => {
  const { orderID } = req.body;
  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});
  try {
    const capture = await paypalClient.execute(request);
    res.json({ status: "success", details: capture.result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));