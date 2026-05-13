// services/email.js — Service Email KibaAlo v2
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"KibaAlo 🛵" <${process.env.SMTP_USER}>`;
const BASE_URL = process.env.FRONTEND_URL || 'https://kibaalo-frontend.vercel.app';

// ── Template HTML de base ────────────────────────────────
const baseTemplate = (content, title) => `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',sans-serif;}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);}
  .header{background:linear-gradient(135deg,#FF6B00,#FFB800);padding:32px;text-align:center;}
  .header h1{color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;}
  .header p{color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;}
  .body{padding:32px;}
  .body h2{color:#1a1a1a;font-size:20px;margin:0 0 16px;}
  .body p{color:#555;line-height:1.6;margin:0 0 16px;}
  .btn{display:inline-block;background:#FF6B00;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;margin:8px 0;}
  .code{background:#FFF3E0;border:2px dashed #FF6B00;border-radius:10px;padding:20px;text-align:center;font-size:32px;font-weight:800;color:#FF6B00;letter-spacing:8px;margin:20px 0;}
  .info-box{background:#f8f8f8;border-radius:10px;padding:16px;margin:16px 0;}
  .info-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:14px;}
  .info-row:last-child{border-bottom:none;}
  .info-label{color:#888;}
  .info-value{font-weight:600;color:#333;}
  .footer{background:#f8f8f8;padding:20px 32px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;}
  .footer a{color:#FF6B00;text-decoration:none;}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>🛵 KibaAlo</h1>
    <p>Livraison & Services — Afrique de l'Ouest</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>© 2025 KibaAlo — Burkina Faso, Niger & Afrique de l'Ouest</p>
    <p><a href="${BASE_URL}">kibaalo.app</a> · <a href="mailto:support@kibaalo.app">support@kibaalo.app</a></p>
    <p style="margin-top:8px;font-size:11px;color:#bbb;">Vous recevez cet email car vous êtes inscrit sur KibaAlo.</p>
  </div>
</div></body></html>`;

const EmailService = {

  // ── Vérification d'email ────────────────────────────
  async sendVerification(to, firstName, token) {
    const link = `${BASE_URL}/verify-email?token=${token}`;
    const content = `
      <h2>Bonjour ${firstName} 👋</h2>
      <p>Bienvenue sur KibaAlo ! Confirmez votre adresse email pour activer votre compte.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${link}" class="btn">✅ Confirmer mon email</a>
      </div>
      <p style="font-size:13px;color:#888;">Ce lien expire dans <strong>24 heures</strong>. Si vous n'avez pas créé de compte, ignorez cet email.</p>
      <p style="font-size:12px;color:#aaa;">Ou copiez ce lien : ${link}</p>`;
    return this._send(to, '✅ Confirmez votre email — KibaAlo', content);
  },

  // ── Réinitialisation mot de passe ───────────────────
  async sendPasswordReset(to, firstName, token) {
    const link = `${BASE_URL}/reset-password?token=${token}`;
    const content = `
      <h2>Réinitialisation de mot de passe</h2>
      <p>Bonjour ${firstName},</p>
      <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous :</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${link}" class="btn">🔑 Réinitialiser mon mot de passe</a>
      </div>
      <p style="font-size:13px;color:#e53e3e;"><strong>⚠️ Ce lien expire dans 1 heure.</strong></p>
      <p style="font-size:13px;color:#888;">Si vous n'avez pas fait cette demande, ignorez cet email. Votre mot de passe ne changera pas.</p>`;
    return this._send(to, '🔑 Réinitialisation de mot de passe — KibaAlo', content);
  },

  // ── Confirmation de commande ─────────────────────────
  async sendOrderConfirmation(to, firstName, order) {
    const items = (order.items || []).map(i =>
      `<div class="info-row"><span class="info-label">${i.emoji||'📦'} ${i.name} x${i.qty}</span><span class="info-value">${(i.price*i.qty).toLocaleString('fr-FR')} F</span></div>`
    ).join('');
    const content = `
      <h2>Commande confirmée ! 🎉</h2>
      <p>Bonjour ${firstName}, votre commande a été reçue et est en cours de traitement.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Numéro de commande</span><span class="info-value" style="font-family:monospace">${order.order_number}</span></div>
        <div class="info-row"><span class="info-label">Boutique</span><span class="info-value">${order.shopName||''}</span></div>
        ${items}
        <div class="info-row"><span class="info-label">Livraison</span><span class="info-value">${(order.delivery_fee||500).toLocaleString('fr-FR')} F</span></div>
        <div class="info-row" style="font-weight:800"><span class="info-label" style="font-weight:800">Total</span><span class="info-value" style="color:#FF6B00;font-size:16px">${(order.total||0).toLocaleString('fr-FR')} F CFA</span></div>
      </div>
      <div style="text-align:center;margin:24px 0;">
        <a href="${BASE_URL}/?tab=orders" class="btn">📦 Suivre ma commande</a>
      </div>`;
    return this._send(to, `📦 Commande ${order.order_number} confirmée — KibaAlo`, content);
  },

  // ── Livraison d'un produit digital ──────────────────
  async sendDigitalProduct(to, firstName, product, purchase) {
    const content = `
      <h2>Votre produit est prêt ! 🎁</h2>
      <p>Bonjour ${firstName},</p>
      <p>Merci pour votre achat. Voici votre accès à <strong>${product.name}</strong> :</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Produit</span><span class="info-value">${product.emoji||'📦'} ${product.name}</span></div>
        <div class="info-row"><span class="info-label">Type</span><span class="info-value">${product.digital_file_type?.toUpperCase()||'FICHIER'}</span></div>
        <div class="info-row"><span class="info-label">Téléchargements max</span><span class="info-value">${purchase.max_downloads} fois</span></div>
        ${purchase.expires_at ? `<div class="info-row"><span class="info-label">Expire le</span><span class="info-value">${new Date(purchase.expires_at).toLocaleDateString('fr-FR')}</span></div>` : ''}
      </div>
      <div class="code">${purchase.download_password}</div>
      <p style="text-align:center;color:#888;font-size:13px;margin-top:-10px;">← Votre mot de passe de téléchargement</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${purchase.download_url}" class="btn">⬇️ Télécharger maintenant</a>
      </div>
      <p style="font-size:13px;color:#e53e3e;"><strong>⚠️ Conservez ce mot de passe précieusement. Il est unique et personnel.</strong></p>
      <p style="font-size:12px;color:#aaa;">Ce lien est valide pour ${purchase.max_downloads} téléchargements maximum. Ne partagez pas ce lien.</p>`;
    return this._send(to, `🎁 Votre produit "${product.name}" est disponible — KibaAlo`, content);
  },

  // ── Facture ──────────────────────────────────────────
  async sendInvoice(to, firstName, invoice, pdfBuffer) {
    const content = `
      <h2>Votre facture est disponible 🧾</h2>
      <p>Bonjour ${firstName},</p>
      <p>Votre facture pour la commande est disponible en pièce jointe et en téléchargement.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">N° Facture</span><span class="info-value" style="font-family:monospace">${invoice.invoice_number}</span></div>
        <div class="info-row"><span class="info-label">Date</span><span class="info-value">${new Date(invoice.created_at).toLocaleDateString('fr-FR')}</span></div>
        <div class="info-row"><span class="info-label">Total</span><span class="info-value" style="color:#FF6B00;font-weight:800">${(invoice.total||0).toLocaleString('fr-FR')} F CFA</span></div>
        <div class="info-row"><span class="info-label">Statut</span><span class="info-value" style="color:green">✅ Payée</span></div>
      </div>
      <p style="font-size:13px;color:#888;">La facture PDF est également jointe à cet email.</p>`;

    const mailOptions = {
      from: FROM,
      to,
      subject: `🧾 Facture ${invoice.invoice_number} — KibaAlo`,
      html: baseTemplate(content, 'Facture KibaAlo'),
    };
    if (pdfBuffer) {
      mailOptions.attachments = [{
        filename: `facture-${invoice.invoice_number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }];
    }
    return transporter.sendMail(mailOptions);
  },

  // ── KYC soumis ──────────────────────────────────────
  async sendKycSubmitted(to, firstName) {
    const content = `
      <h2>Documents reçus ✅</h2>
      <p>Bonjour ${firstName},</p>
      <p>Nous avons bien reçu vos documents d'identité. Notre équipe va les vérifier dans les <strong>24 à 48 heures</strong>.</p>
      <p>Vous recevrez un email dès que votre compte sera vérifié.</p>`;
    return this._send(to, '📋 Documents reçus — KibaAlo', content);
  },

  // ── KYC validé ──────────────────────────────────────
  async sendKycVerified(to, firstName) {
    const content = `
      <h2>Compte vérifié ! 🎉</h2>
      <p>Bonjour ${firstName},</p>
      <p>Votre identité a été vérifiée avec succès. Vous avez maintenant accès à toutes les fonctionnalités de KibaAlo !</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${BASE_URL}" class="btn">🚀 Accéder à mon compte</a>
      </div>`;
    return this._send(to, '✅ Compte vérifié — KibaAlo', content);
  },

  // ── Bienvenue ────────────────────────────────────────
  async sendWelcome(to, firstName, role) {
    const roleLabels = { client:'Client', livreur:'Livreur', commercant:'Commerçant' };
    const content = `
      <h2>Bienvenue sur KibaAlo ${firstName} ! 🎉</h2>
      <p>Votre compte <strong>${roleLabels[role]||role}</strong> est créé avec succès.</p>
      <p>KibaAlo, c'est la plateforme de livraison et services qui connecte toute l'Afrique de l'Ouest.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${BASE_URL}" class="btn">🛵 Découvrir KibaAlo</a>
      </div>`;
    return this._send(to, `🎉 Bienvenue sur KibaAlo, ${firstName} !`, content);
  },

  // ── Core send ────────────────────────────────────────
  async _send(to, subject, content) {
    try {
      await transporter.sendMail({
        from: FROM,
        to,
        subject,
        html: baseTemplate(content, subject),
      });
    } catch (err) {
      console.error('[Email] Erreur envoi vers', to, ':', err.message);
      // Ne pas bloquer l'app si l'email échoue
    }
  },

  async verify() {
    try {
      await transporter.verify();
      console.log('✅ Service email connecté');
      return true;
    } catch (err) {
      console.warn('⚠️ Service email non configuré:', err.message);
      return false;
    }
  },
};

module.exports = EmailService;
