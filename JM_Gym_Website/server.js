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

// --- 1. PFAD ZUM FRONTEND ---
const publicPath = path.join(__dirname, 'web');

console.log("--- SERVER START CHECK ---");
try {
    if (fs.existsSync(publicPath)) {
        console.log("✅ Ordner 'web' gefunden.");
    } else {
        console.error("❌ KRITISCH: Ordner 'web' nicht gefunden!");
    }
} catch(e) { console.error(e); }

// --- 2. DATENBANK ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB verbunden!"))
    .catch(err => console.error("❌ MongoDB Fehler:", err));

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

// --- 3. PAYPAL ---
const Environment = paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// --- 4. MIDDLEWARE ---
app.use(express.json());
app.use(cors());
app.use(express.static(publicPath));

// --- 5. SEITEN ROUTEN (Hauptseite & Rechtliches) ---
app.get("/", (req, res) => res.sendFile(path.join(publicPath, "index.html")));
app.get("/impressum", (req, res) => res.sendFile(path.join(publicPath, "impressum.html")));
app.get("/agb", (req, res) => res.sendFile(path.join(publicPath, "agb.html")));
app.get("/widerruf", (req, res) => res.sendFile(path.join(publicPath, "widerruf.html")));
app.get("/versand", (req, res) => res.sendFile(path.join(publicPath, "versand.html")));
app.get("/kontakt", (req, res) => res.sendFile(path.join(publicPath, "kontakt.html")));
app.get("/datenschutz", (req, res) => res.sendFile(path.join(publicPath, "datenschutz.html")));

// --- 6. AUTH ROUTEN ---
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

// --- 7. PAYMENT ROUTEN ---
app.get("/config", (req, res) => res.send({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY }));

app.post("/create-payment-intent", async (req, res) => {
    const { amount } = req.body;
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            currency: "eur", amount: Math.round(amount * 100), automatic_payment_methods: { enabled: true }
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (e) { res.