let cart = []; let total = 0; let discountApplied = false; let stripe, elements;
let isRegisterMode = false;

const cartSidebar = document.getElementById('cart-sidebar');
const cartItemsContainer = document.getElementById('cart-items');
const cartTotalElement = document.getElementById('cart-total');
const cartCountElement = document.querySelector('.cart-count');
const checkoutModal = document.getElementById('checkout-modal');
const loginModal = document.getElementById('login-modal');

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const response = await fetch("/config");
        const { stripePublishableKey } = await response.json();
        stripe = Stripe(stripePublishableKey);
    } catch(e){}
    
    checkLoginStatus();
    
    const cartBtn = document.getElementById('cart-btn');
    const closeCart = document.getElementById('close-cart');
    if(cartBtn) cartBtn.addEventListener('click', () => cartSidebar.classList.add('open'));
    if(closeCart) closeCart.addEventListener('click', () => cartSidebar.classList.remove('open'));

    const loginTrig = document.getElementById('login-btn-trigger');
    const closeLogin = document.getElementById('close-login');
    if(loginTrig) loginTrig.addEventListener('click', () => { if(!localStorage.getItem('token')) loginModal.style.display='flex'; });
    if(closeLogin) closeLogin.addEventListener('click', () => loginModal.style.display='none');

    const closeCheck = document.getElementById('close-checkout');
    if(closeCheck) closeCheck.addEventListener('click', () => checkoutModal.style.display='none');

    // Auth Tabs
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const authBtn = document.getElementById('auth-action-btn');
    
    if(tabLogin) tabLogin.addEventListener('click', () => { isRegisterMode = false; tabLogin.classList.add('active'); tabRegister.classList.remove('active'); authBtn.innerText = "Einloggen"; });
    if(tabRegister) tabRegister.addEventListener('click', () => { isRegisterMode = true; tabRegister.classList.add('active'); tabLogin.classList.remove('active'); authBtn.innerText = "Registrieren"; });

    // Login Submit
    const loginForm = document.getElementById('login-form');
    if(loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const endpoint = isRegisterMode ? "/register" : "/login";
        try {
            const res = await fetch(endpoint, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({email, password}) });
            const data = await res.json();
            if(res.ok) {
                if(isRegisterMode) { alert("Registriert! Bitte einloggen."); tabLogin.click(); }
                else { localStorage.setItem('token', data.token); localStorage.setItem('user', data.email); alert("Willkommen!"); loginModal.style.display='none'; checkLoginStatus(); }
            } else alert(data.message);
        } catch(err) { alert("Fehler"); }
    });

    // Checkout Start
    const checkBtn = document.getElementById('checkout-btn');
    if(checkBtn) checkBtn.addEventListener('click', async () => {
        if(cart.length === 0) return alert("Warenkorb leer");
        cartSidebar.classList.remove('open'); checkoutModal.style.display='flex';
        document.getElementById('checkout-total-amount').innerText = total.toFixed(2) + ' €';
        
        const res = await fetch("/create-payment-intent", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({amount:total}) });
        const {clientSecret} = await res.json();
        elements = stripe.elements({ clientSecret, appearance: { theme: 'night' } });
        elements.create("payment").mount("#stripe-payment-element");
        
        document.getElementById('paypal-button-container').innerHTML = "";
        paypal.Buttons({
            style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
            createOrder: (d,a) => fetch("/create-paypal-order", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:total})}).then(r=>r.json()).then(d=>d.id),
            onApprove: (d,a) => fetch("/capture-paypal-order", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderID:d.orderID})}).then(r=>r.json()).then(()=>{ alert("Danke!"); checkoutModal.style.display='none'; cart=[]; updateCartDisplay(); })
        }).render('#paypal-button-container');
    });

    document.getElementById('checkout-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href } });
        if(error) alert(error.message);
    });
});

// Globale Funktionen für HTML onclick
window.addToCart = function(n, p) { cart.push({name:n, price:p}); updateCartDisplay(); if(cartSidebar) cartSidebar.classList.add('open'); }
window.removeFromCart = function(i) { cart.splice(i, 1); updateCartDisplay(); }

function updateCartDisplay() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total');
    const countEl = document.querySelector('.cart-count');
    container.innerHTML = ''; total = 0;
    
    if(cart.length === 0) container.innerHTML = '<p style="text-align:center; color:#888;">Dein Warenkorb ist leer.</p>';
    else cart.forEach((item, i) => {
        total += item.price;
        const div = document.createElement('div'); div.classList.add('cart-item');
        div.innerHTML = `<span>${item.name}</span> <div style="display:flex; gap:10px;"><span>${item.price.toFixed(2)}€</span> <i class="fas fa-trash" onclick="window.removeFromCart(${i})" style="color:#ff4444; cursor:pointer;"></i></div>`;
        container.appendChild(div);
    });
    
    if (discountApplied) total *= 0.9;
    if(totalEl) totalEl.innerText = total.toFixed(2) + ' €';
    if(countEl) countEl.innerText = cart.length;
}

function checkLoginStatus() {
    const t = localStorage.getItem('token');
    const icon = document.getElementById('login-btn-trigger');
    if(t && icon) {
        icon.style.color = "#00ff88"; icon.title = "User: " + localStorage.getItem('user');
        icon.onclick = (e) => { e.stopImmediatePropagation(); if(confirm("Ausloggen?")) { localStorage.clear(); location.reload(); } };
    }
}
// --- COOKIE LOGIK ---
document.addEventListener("DOMContentLoaded", () => {
    const cookieBanner = document.getElementById('cookie-banner');
    const acceptBtn = document.getElementById('cookie-accept');
    const declineBtn = document.getElementById('cookie-decline');

    // 1. Prüfen: Hat der User schon entschieden?
    if (!localStorage.getItem('cookieConsent')) {
        // Wenn nein: Banner anzeigen (nach kurzer Verzögerung für schöneren Effekt)
        setTimeout(() => {
            cookieBanner.classList.add('show');
        }, 1000);
    }

    // 2. Funktion: Akzeptieren
    if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            localStorage.setItem('cookieConsent', 'accepted');
            cookieBanner.classList.remove('show');
            // Hier könntest du später Analytics-Scripts laden (z.B. Google Analytics)
            console.log("Cookies akzeptiert.");
        });
    }

    // 3. Funktion: Ablehnen (Nur Essentielle)
    if (declineBtn) {
        declineBtn.addEventListener('click', () => {
            localStorage.setItem('cookieConsent', 'declined');
            cookieBanner.classList.remove('show');
            console.log("Nur essentielle Cookies.");
        });
    }
});