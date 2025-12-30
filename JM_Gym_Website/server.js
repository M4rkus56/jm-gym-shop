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
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const app = express();
const publicPath = path.join(__dirname, 'web');

// --- 1. WARTUNGS-MODUS (Muss ganz oben stehen!) ---
app.use((req, res, next) => {
    // Prüft, ob bei Kinsta die Variable MAINTENANCE_MODE auf "true" steht
    if (process.env.MAINTENANCE_MODE === "true") {
        // Erlaube Bilder, CSS & JS, damit die Wartungsseite gut aussieht
        if (req.url.match(/\.(css|js|jpg|png|ico|woff2)$/)) {
            return next();
        }
        // Zeige jedem Besucher die Wartungsseite
        return res.sendFile(path.join(publicPath, "wartung.html"));
    }
    next();
});

// --- 2. DATENBANK ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB verbunden"))
    .catch(err => console.error("❌ DB Fehler:", err));

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String }, // Optional (Google User haben keins)
    googleId: { type: String }, // Neu: Für Google User
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

// --- 3. PAYPAL SETUP ---
const Environment = paypal.core.SandboxEnvironment; // Später: LiveEnvironment
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// --- 4. GOOGLE AUTH STRATEGIE ---
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
        // Prüfen: Gibt es den User schon?
        let user = await User.findOne({ email: profile.emails[0].value });
        if (user) {
            // User existiert -> Google ID nachtragen falls fehlt
            if (!user.googleId) {
                user.googleId = profile.id;
                await user.save();
            }
            return done(null, user);
        } else {
            // User neu -> Erstellen (ohne Passwort)
            user = new User({
                email: profile.emails[0].value,
                googleId: profile.id
            });
            await user.save();
            return done(null, user);
        }
    } catch (err) { return done(err, null); }
  }
));

// --- 5. MIDDLEWARE ---
app.use(express.json());
app.use(cors());
app.use(express.static(publicPath));
app.use(passport.initialize()); // Passport starten

// --- 6. SEITEN ROUTEN ---
app.get("/", (req, res) => res.sendFile(path.join(publicPath, "index.html")));
app.get("/mens-performance", (req, res) => res.sendFile(path.join(publicPath, "mens-performance.html")));
app.get("/impressum", (req, res) => res.sendFile(path.join(publicPath, "impressum.html")));
app.get("/agb", (req, res) => res.sendFile(path.join(publicPath, "agb.html")));
app.get("/widerruf", (req, res) => res.sendFile(path.join(publicPath, "widerruf.html")));
app.get("/versand", (req, res) => res.sendFile(path.join(publicPath, "versand.html")));
app.get("/kontakt", (req, res) => res.sendFile(path.join(publicPath, "kontakt.html")));
app.get("/datenschutz", (req, res) => res.sendFile(path.join(publicPath, "datenschutz.html")));
// Wartungsseite Route (für Testzwecke)
app.get("/wartung", (req, res) => res.sendFile(path.join(publicPath, "wartung.html")));


// --- 7. AUTH & LOGIN ROUTEN ---

// A) Google Login Start
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// B) Google Login Callback (Hier kommt Google zurück)
app.get('/auth/google/callback', 
  passport.authenticate('google', { session: false, failureRedirect: '/' }),
  (req, res) => {
    // Token erstellen
    const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    // Zurück zur Startseite mit Token in der URL
    res.redirect(`/?token=${token}&email=${req.user.email}`);
  }
);

// C) Normales Registrieren (mit Auto-Login)
app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    try {
        const existing = await User.findOne({ email });
        if(existing) return res.status(400).json({message:"E-Mail vergeben"});
        
        const hashed = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashed });
        await user.save();
        
        // Token direkt erstellen
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.status(201).json({ message: "Erfolg", token, email: user.email });
    } catch(e) { res.status(500).json({message:"Fehler"}); }
});

// D) Normales Login
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "User nicht gefunden" });
        if (!user.password) return res.status(400).json({ message: "Bitte mit Google einloggen" });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Falsches Passwort" });
        
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ token, email: user.email });
    } catch (e) { res.status(500).json({ message: "Fehler" }); }
});


// --- 8. PAYMENT ROUTEN ---
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

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
