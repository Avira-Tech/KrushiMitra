'use strict';

const express = require('express');
const router = express.Router();

router.get('/payment-page/:orderId', (req, res) => {
  const { orderId } = req.params;
  const keyId = process.env.RAZORPAY_KEY_ID;

  if (!keyId) {
    return res.status(500).send('Razorpay Key ID is not configured on the server.');
  }

  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>KrushiMitra Secure Payment</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <style>
      body {
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: #f8f9fa;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #333;
      }
      .loader {
        border: 4px solid #f3f3f3;
        border-top: 4px solid #2E7D32;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin-bottom: 20px;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .content { text-align: center; padding: 20px; }
      h2 { margin: 0 0 10px; color: #2E7D32; font-weight: 800; }
      p { margin: 0; color: #666; font-size: 14px; }
    </style>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  </head>
  <body>
    <div class="loader"></div>
    <div class="content">
      <h2>Processing Payment</h2>
      <p>Securely connecting to Razorpay...</p>
    </div>

    <script>
      window.onload = function() {
        try {
          var options = {
            key: "${keyId}",
            order_id: "${orderId}",
            name: "KrushiMitra",
            description: "Safe & Secure Escrow Payment",
            image: "https://krushimitra.in/logo.png",
            theme: { color: "#2E7D32" },

            handler: function (response) {
              // Extract data and redirect back to app using deep link
              var params = new URLSearchParams({
                payment_id: response.razorpay_payment_id,
                order_id: response.razorpay_order_id,
                signature: response.razorpay_signature
              });
              window.location.href = "krushimitra://payment-success?" + params.toString();
            },

            modal: {
              ondismiss: function () {
                window.location.href = "krushimitra://payment-cancel";
              }
            },
            
            // Prefill can be added if passed via query params
            prefill: {
              name: "",
              email: "",
              contact: ""
            }
          };

          var rzp = new Razorpay(options);
          
          rzp.on('payment.failed', function (response){
            window.location.href = "krushimitra://payment-failure?code=" + response.error.code;
          });

          rzp.open();
        } catch (e) {
          console.error("Razorpay error:", e);
          document.body.innerHTML = "<div class='content'><h2>Error</h2><p>Failed to initialize payment gateway.</p></div>";
        }
      };
    </script>
  </body>
  </html>
  `);
});

module.exports = router;