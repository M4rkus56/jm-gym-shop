require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require('fs');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const paypal = require("@paypal/checkout-server-sdk");

const app = express();

// --- PFAD DEFINITION ---
const publicPath = path.join(__dirname, 'web');

// --- DATENBANK ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch(err => console.error("❌ MongoDB Fehler:", err));

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

// --- PAYPAL ---
const Environment = paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// --- MIDDLEWARE ---
app.use(express.json());
app.use(cors());
app.use(express.static(publicPath));

// --- ROUTEN ---

// Startseite ausliefern
app.get("/", (req, res) => {
    const indexFile = path.join(publicPath, "index.html");
    if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
    } else {
        res.status(500).send("Fehler: index.html nicht im Ordner 'web' gefunden!");
    }
});

// Auth
app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "E-Mail vergeben." });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: "Erstellt" });
    } catch (e) { res.status(500).json({ message: "Fehler" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "User nicht gefunden" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Falsches Passwort" });
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ token, email: user.email });
    } catch (e) { res.status(500).json({ message: "Fehler" }); }
});

// Payment
app.get("/config", (req, res) => res.send({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY }));

app.post("/create-payment-intent", async (req, res) => {
    const { amount } = req.body;
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            currency: "eur", amount: Math.round(amount * 100), automatic_payment_methods: { enabled: true }
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (e) { res.status(400).send({ error: { message: e.message } }); }
});

app.post("/create-paypal-order", async (req, res) => {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "EUR", value: req.body.amount.toFixed(2) } }]
    });
    try {
        const order = await paypalClient.execute(request);
        res.json({ id: order.result.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/capture-paypal-order", async (req, res) => {
    const request = new paypal.orders.OrdersCaptureRequest(req.body.orderID);
    request.requestBody({});
    try {
        const capture = await paypalClient.execute(request);
        res.json({ status: "success", details: capture.result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));