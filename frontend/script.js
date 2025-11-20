let cart = [];
let total = 0;
let discountApplied = false;
let stripe, elements;

// --- DOM Elemente ---
const cartSidebar = document.getElementById('cart-sidebar');
const cartItemsContainer = document.getElementById('cart-items');
const cartTotalElement = document.getElementById('cart-total');
const cartCountElement = document.querySelector('.cart-count');
const checkoutModal = document.getElementById('checkout-modal');

// --- 1. STRIPE & FRONTEND INITIALISIERUNG ---
async function initializeStripe() {
    const response = await fetch("/config");
    const { stripePublishableKey } = await response.json();
    stripe = Stripe(stripePublishableKey);
}
initializeStripe();

// --- 2. WARENKORB FUNKTIONEN ---
function addToCart(productName, price) {
    cart.push({ name: productName, price: price });
    updateCartDisplay();
    cartSidebar.classList.add('open');
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartDisplay();
}

function updateCartDisplay() {
    cartItemsContainer.innerHTML = '';
    total = 0;

    if(cart.length === 0) {
        cartItemsContainer.innerHTML = '<p class="empty-cart-msg">Dein Warenkorb ist leer.</p>';
    } else {
        cart.forEach((item, index) => {
            total += item.price;
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('cart-item');
            itemDiv.innerHTML = `
                <span>${item.name}</span>
                <div>
                    <span>${item.price.toFixed(2)} €</span>
                    <i class="fas fa-trash" onclick="removeFromCart(${index})" style="margin-left:10px; cursor:pointer; color:#ff4444;"></i>
                </div>
            `;
            cartItemsContainer.appendChild(itemDiv);
        });
    }

    if (discountApplied) total = total * 0.90;
    cartTotalElement.innerText = total.toFixed(2) + ' €';
    cartCountElement.innerText = cart.length;
}

// Rabatt Code
document.getElementById('apply-discount').addEventListener('click', () => {
    const input = document.getElementById('discount-input').value.toUpperCase();
    if (input === 'JM10' && !discountApplied) {
        discountApplied = true;
        updateCartDisplay();
        document.getElementById('discount-msg').innerText = "Rabatt aktiv!";
    }
});

// Sidebar Toggle
document.getElementById('cart-btn').addEventListener('click', () => cartSidebar.classList.add('open'));
document.getElementById('close-cart').addEventListener('click', () => cartSidebar.classList.remove('open'));
document.getElementById('close-checkout').addEventListener('click', () => checkoutModal.style.display = 'none');

// --- 3. CHECKOUT (PAYPAL & STRIPE ZUSAMMEN) ---
document.getElementById('checkout-btn').addEventListener('click', async () => {
    if (cart.length === 0) { alert("Warenkorb leer!"); return; }
    
    cartSidebar.classList.remove('open');
    checkoutModal.style.display = 'flex';
    document.getElementById('checkout-total-amount').innerText = total.toFixed(2) + ' €';

    // A) STRIPE LADEN
    const response = await fetch("/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: total })
    });
    const { clientSecret } = await response.json();
    
    elements = stripe.elements({ clientSecret, appearance: { theme: 'night', labels: 'floating' } });
    const paymentElement = elements.create("payment");
    paymentElement.mount("#stripe-payment-element");

    // B) PAYPAL BUTTON RENDERN
    const container = document.getElementById('paypal-button-container');
    container.innerHTML = ""; // Reset falls schon vorhanden
    
    paypal.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },

        // Order erstellen
        createOrder: function(data, actions) {
            return fetch("/create-paypal-order", {
                method: "post",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: total })
            })
            .then((res) => res.json())
            .then((orderData) => { return orderData.id; });
        },

        // Zahlung genehmigen (Kunde hat bei PayPal OK geklickt)
        onApprove: function(data, actions) {
            return fetch("/capture-paypal-order", {
                method: "post",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderID: data.orderID })
            })
            .then((res) => res.json())
            .then((orderData) => {
                alert("Zahlung mit PayPal erfolgreich!");
                checkoutModal.style.display = 'none';
                cart = [];
                updateCartDisplay();
            });
        },
        onError: (err) => { console.error(err); alert("Fehler bei PayPal."); }
    }).render('#paypal-button-container');
});

// --- 4. STRIPE ZAHLUNG ABSENDEN ---
document.getElementById('checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-payment');
    btn.disabled = true;
    btn.innerText = "Verarbeite...";

    const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
    });

    if (error) {
        document.getElementById("payment-message").innerText = error.message;
        document.getElementById("payment-message").style.display = "block";
        btn.disabled = false;
    }
});

// --- 5. STRIPE ERFOLG CHECK ---
async function checkPaymentStatus() {
    const clientSecret = new URLSearchParams(window.location.search).get("payment_intent_client_secret");
    if (!clientSecret) return;
    const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
    if (paymentIntent && paymentIntent.status === "succeeded") {
        alert("Kreditkartenzahlung erfolgreich!");
        cart = [];
        updateCartDisplay();
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}
checkPaymentStatus();

// Popup
setTimeout(() => {
    if(!sessionStorage.getItem('popupClosed')) document.getElementById('promo-popup').classList.add('show');
}, 2500);
document.getElementById('close-popup').addEventListener('click', () => {
    document.getElementById('promo-popup').classList.remove('show');
    sessionStorage.setItem('popupClosed', 'true');
});