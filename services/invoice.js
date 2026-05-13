// services/invoice.js — Générateur de factures PDF KibaAlo v2
const PDFDocument = require('pdfkit');

const InvoiceService = {

  // Générer un numéro de facture unique
  generateNumber(orderId) {
    const date = new Date();
    const year  = date.getFullYear();
    const month = String(date.getMonth()+1).padStart(2,'0');
    const rand  = Math.floor(Math.random()*9000+1000);
    return `KBA-${year}${month}-${rand}`;
  },

  // Générer le PDF de facture
  async generate(invoice) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers = [];
        doc.on('data', b => buffers.push(b));
        doc.on('end',  () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        const orange = '#FF6B00';
        const dark   = '#1A1A1A';
        const gray   = '#666666';
        const light  = '#F5F5F5';
        const W = 595 - 100; // largeur utile

        // ── ENTÊTE ───────────────────────────────────────
        // Fond orange
        doc.rect(0, 0, 595, 120).fill(orange);

        // Logo / Nom
        doc.fillColor('#fff').fontSize(28).font('Helvetica-Bold').text('KibaAlo', 50, 35);
        doc.fontSize(11).font('Helvetica').text('Livraison & Services — Afrique de l\'Ouest', 50, 68);
        doc.fontSize(10).text('kibaalo.app  ·  support@kibaalo.app', 50, 85);

        // FACTURE
        doc.fontSize(14).font('Helvetica-Bold').text('FACTURE', 430, 40, { align: 'right', width: 115 });
        doc.fontSize(11).font('Helvetica').fillColor('rgba(255,255,255,0.85)')
           .text(invoice.invoice_number, 430, 62, { align: 'right', width: 115 })
           .text(new Date(invoice.created_at || Date.now()).toLocaleDateString('fr-FR'), 430, 80, { align: 'right', width: 115 });

        doc.fillColor(dark);
        let y = 145;

        // ── INFOS CLIENT & BOUTIQUE ──────────────────────
        const col1 = 50, col2 = 310;

        // Bloc client
        doc.roundedRect(col1, y, 240, 110, 8).fill(light);
        doc.fillColor(orange).fontSize(10).font('Helvetica-Bold').text('FACTURER À', col1+14, y+14);
        doc.fillColor(dark).fontSize(11).font('Helvetica-Bold').text(invoice.client_name || 'Client', col1+14, y+30);
        doc.fontSize(10).font('Helvetica').fillColor(gray)
           .text(invoice.client_email || '', col1+14, y+48)
           .text(invoice.client_phone || '', col1+14, y+64)
           .text(invoice.client_address || invoice.delivery_city || '', col1+14, y+80, { width: 210 });

        // Bloc boutique
        doc.roundedRect(col2, y, 240, 110, 8).fill(light);
        doc.fillColor(orange).fontSize(10).font('Helvetica-Bold').text('VENDEUR', col2+14, y+14);
        doc.fillColor(dark).fontSize(11).font('Helvetica-Bold').text(invoice.shop_name || 'Boutique', col2+14, y+30);
        doc.fontSize(10).font('Helvetica').fillColor(gray)
           .text(invoice.shop_address || '', col2+14, y+48, { width: 210 })
           .text(invoice.shop_phone || '', col2+14, y+80);

        y += 130;

        // ── DÉTAILS COMMANDE ─────────────────────────────
        // En-têtes tableau
        doc.rect(50, y, W, 32).fill(orange);
        doc.fillColor('#fff').fontSize(10).font('Helvetica-Bold');
        doc.text('ARTICLE', 64, y+10);
        doc.text('QTÉ', 340, y+10, { width: 50, align: 'center' });
        doc.text('P.U.', 400, y+10, { width: 70, align: 'right' });
        doc.text('TOTAL', 475, y+10, { width: 75, align: 'right' });

        y += 32;

        // Lignes articles
        const items = invoice.items || [];
        items.forEach((item, i) => {
          const bg = i % 2 === 0 ? '#FFFFFF' : light;
          doc.rect(50, y, W, 30).fill(bg);
          doc.fillColor(dark).fontSize(10).font('Helvetica');
          doc.text(`${item.emoji||'📦'} ${item.name}`, 64, y+9, { width: 270 });
          doc.text(String(item.qty||1), 340, y+9, { width: 50, align: 'center' });
          doc.text(this._fmt(item.price), 400, y+9, { width: 70, align: 'right' });
          doc.text(this._fmt((item.price||0)*(item.qty||1)), 475, y+9, { width: 75, align: 'right' });
          y += 30;
        });

        // Bordure tableau
        doc.rect(50, y - items.length*30 - 32, W, items.length*30+32).stroke('#E0E0E0');

        y += 16;

        // ── TOTAUX ───────────────────────────────────────
        const totalsX = 380;
        const totalsW = 165;
        const addTotalRow = (label, value, bold, color) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
             .fillColor(color || gray)
             .fontSize(bold ? 12 : 10);
          doc.text(label, totalsX, y, { width: 85 });
          doc.text(value, totalsX + 85, y, { width: totalsW - 85, align: 'right' });
          y += bold ? 20 : 18;
        };

        addTotalRow('Sous-total', this._fmt(invoice.subtotal));
        if (invoice.discount_amount > 0) addTotalRow('Remise', `-${this._fmt(invoice.discount_amount)}`, false, '#e53e3e');
        addTotalRow('Livraison', this._fmt(invoice.delivery_fee || 0));
        if (invoice.tax_amount > 0) addTotalRow(`TVA (${invoice.tax_rate||0}%)`, this._fmt(invoice.tax_amount));

        // Ligne séparatrice
        doc.moveTo(totalsX, y).lineTo(595 - 50, y).stroke('#E0E0E0');
        y += 8;

        // Total principal
        doc.roundedRect(totalsX - 10, y - 4, totalsW + 10, 36, 8).fill(orange);
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13);
        doc.text('TOTAL', totalsX, y + 8, { width: 85 });
        doc.text(this._fmt(invoice.total), totalsX + 85, y + 8, { width: totalsW - 85, align: 'right' });

        y += 56;

        // ── INFOS PAIEMENT ───────────────────────────────
        doc.roundedRect(50, y, W, 60, 8).fill(light);
        doc.fillColor(orange).fontSize(10).font('Helvetica-Bold').text('INFORMATIONS DE PAIEMENT', 64, y+12);
        doc.fillColor(dark).fontSize(10).font('Helvetica')
           .text(`Méthode : ${this._payLabel(invoice.payment_method)}`, 64, y+28)
           .text(`Statut : ✅ Payée`, 300, y+28)
           .text(`Devise : Franc CFA (XOF)`, 64, y+44);

        y += 76;

        // ── NOTE / MENTIONS ──────────────────────────────
        if (y < 720) {
          doc.fillColor(gray).fontSize(9).font('Helvetica')
             .text('Merci pour votre confiance. Pour toute question, contactez support@kibaalo.app', 50, y, { align: 'center', width: W })
             .text('KibaAlo — Plateforme de livraison et services pour l\'Afrique de l\'Ouest', 50, y+14, { align: 'center', width: W });
        }

        doc.end();

      } catch (err) {
        reject(err);
      }
    });
  },

  _fmt: (n) => `${(+(n)||0).toLocaleString('fr-FR')} F CFA`,

  _payLabel: (method) => ({
    wallet:       '👛 Portefeuille KibaAlo',
    orange_money: '🟠 Orange Money',
    moov_money:   '💛 Moov Money',
    wave:         '🌊 Wave',
    mtn_money:    '💛 MTN Money',
    airtel_money: '🔴 Airtel Money',
    free_money:   '🟣 Free Money',
    card:         '💳 Carte bancaire',
    cash:         '💵 Espèces',
    bank_transfer:'🏦 Virement bancaire',
  }[method] || method || 'Autre'),
};

module.exports = InvoiceService;
