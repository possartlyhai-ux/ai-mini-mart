// Seed: 1 Owner, 1 Staff, a default printer, and 18 products that MIRROR the
// storefront catalog (js/data.js) so the storefront feed matches immediately.
//
// Re-runnable: users/products are upserted by username/sku, so `npm run seed`
// is safe on an existing database (it won't duplicate rows or reset live stock
// it already created).
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/lib/auth');
const { bahtToMinor, RATES } = require('../src/lib/currency');
const { ROLES } = require('../src/config/permissions');
const { DEFAULT_CATEGORIES } = require('../src/config/categories');

const pic = (seed) => `https://picsum.photos/seed/${seed}/640/640`;

// Parallel to storefront PRODUCTS. The `stock` figure is only used to derive the
// boolean `inStock` (stock 0 -> out of stock); the two zero items reproduce the
// storefront's out-of-stock products. `wasTHB` is retained as catalog data but is
// no longer seeded into the DB (compare-at price was removed from the staff UI).
const SOURCE = [
  { name: 'Aurora Wireless Earbuds', tags: ['electronics', 'accessories'], priceTHB: 1290, wasTHB: 1790, unit: '1 pair', variantLabel: 'Color', stock: 40,
    variants: [{ label: 'Cloud White', swatch: '#EDEDED', img: pic('mymart-earbuds-white') }, { label: 'Onyx Black', swatch: '#1C1C1C', img: pic('mymart-earbuds-black') }] },
  { name: 'Terra Ceramic Pour-Over Set', tags: ['home'], priceTHB: 890, unit: '600 ml', variantLabel: 'Color', stock: 25,
    variants: [{ label: 'Clay', swatch: '#C96F4A', img: pic('mymart-pourover-clay') }, { label: 'Sand', swatch: '#DCC9A6', img: pic('mymart-pourover-sand') }] },
  { name: 'Drift Linen Overshirt', tags: ['apparel'], priceTHB: 1150, wasTHB: 1450, unit: 'Unisex', variantLabel: 'Color', stock: 18,
    variants: [{ label: 'Olive', swatch: '#6B7253', img: pic('mymart-overshirt-olive') }, { label: 'Ecru', swatch: '#E6DDC7', img: pic('mymart-overshirt-ecru') }] },
  { name: 'Nimbus 65% Mechanical Keyboard', tags: ['electronics'], priceTHB: 2490, wasTHB: 2990, unit: '68 keys', variantLabel: 'Color', stock: 12,
    variants: [{ label: 'Slate', swatch: '#3A4A5A', img: pic('mymart-keyboard-slate') }, { label: 'Cream', swatch: '#EDE6D6', img: pic('mymart-keyboard-cream') }] },
  { name: 'Harvest Cotton Tote', tags: ['accessories', 'apparel'], priceTHB: 390, unit: '14 L', variantLabel: 'Color', stock: 4, // low stock
    variants: [{ label: 'Natural', swatch: '#E3D8BE', img: pic('mymart-tote-natural') }, { label: 'Forest', swatch: '#2F4A3A', img: pic('mymart-tote-forest') }] },
  { name: 'Forge 24-piece Driver Kit', tags: ['tools'], priceTHB: 690, wasTHB: 980, unit: '24 pcs', variantLabel: 'Finish', stock: 0, // out of stock
    variants: [{ label: 'Graphite', swatch: '#2B2B2B', img: pic('mymart-driver-graphite') }, { label: 'Steel', swatch: '#9AA3A8', img: pic('mymart-driver-steel') }] },
  { name: 'Lumen Smart Desk Lamp', tags: ['electronics', 'home'], priceTHB: 1090, unit: '5 W', variantLabel: 'Color', stock: 22,
    variants: [{ label: 'White', swatch: '#F4F4F4', img: pic('mymart-lamp-white') }, { label: 'Black', swatch: '#222222', img: pic('mymart-lamp-black') }] },
  { name: 'Stovetop Espresso Maker', tags: ['home', 'grocery'], priceTHB: 760, wasTHB: 990, unit: '300 ml', variantLabel: 'Size', stock: 16,
    variants: [{ label: '3-cup', swatch: '#C8C8C8', img: pic('mymart-moka-3') }, { label: '6-cup', swatch: '#8A8A8A', img: pic('mymart-moka-6') }] },
  { name: 'Trailhead 20L Daypack', tags: ['accessories'], priceTHB: 1390, unit: '20 L', variantLabel: 'Color', stock: 14,
    variants: [{ label: 'Black', swatch: '#232323', img: pic('mymart-daypack-black') }, { label: 'Sand', swatch: '#C9B79A', img: pic('mymart-daypack-sand') }, { label: 'Teal', swatch: '#1F6F6B', img: pic('mymart-daypack-teal') }] },
  { name: 'Pulse Fitness Smartwatch', tags: ['electronics', 'accessories'], priceTHB: 1990, wasTHB: 2590, unit: '1.4 in', variantLabel: 'Color', stock: 9,
    variants: [{ label: 'Midnight', swatch: '#1B2430', img: pic('mymart-watch-midnight') }, { label: 'Rose', swatch: '#D98E8E', img: pic('mymart-watch-rose') }] },
  { name: 'Garden Stainless Tool Trio', tags: ['tools', 'home'], priceTHB: 540, unit: '3 pcs', variantLabel: 'Handle', stock: 30,
    variants: [{ label: 'Wood', swatch: '#9B6B43', img: pic('mymart-garden-wood') }, { label: 'Mint', swatch: '#9FCBB2', img: pic('mymart-garden-mint') }] },
  { name: 'Everyday Merino Crew Socks (3-pack)', tags: ['apparel'], priceTHB: 320, wasTHB: 420, unit: '3 pairs', variantLabel: 'Size', stock: 3, // low stock
    variants: [{ label: 'M', swatch: '#D8D8D8', img: pic('mymart-socks-m') }, { label: 'L', swatch: '#B0B0B0', img: pic('mymart-socks-l') }] },
  { name: 'Highland Single-Origin Coffee 250g', tags: ['grocery'], priceTHB: 280, unit: '250 g', variantLabel: 'Roast', stock: 60,
    variants: [{ label: 'Medium', swatch: '#8A5A3B', img: pic('mymart-coffee-medium') }, { label: 'Dark', swatch: '#4A2F22', img: pic('mymart-coffee-dark') }] },
  { name: 'Cascade Insulated Bottle 750ml', tags: ['accessories', 'home'], priceTHB: 450, wasTHB: 590, unit: '750 ml', variantLabel: 'Color', stock: 28,
    variants: [{ label: 'Glacier', swatch: '#BCD6E0', img: pic('mymart-bottle-glacier') }, { label: 'Coral', swatch: '#E8765A', img: pic('mymart-bottle-coral') }, { label: 'Charcoal', swatch: '#333333', img: pic('mymart-bottle-charcoal') }] },
  { name: 'Atlas Cordless Drill 18V', tags: ['tools'], priceTHB: 2190, wasTHB: 2690, unit: '18 V', variantLabel: 'Color', stock: 0, // out of stock
    variants: [{ label: 'Yellow', swatch: '#F2B705', img: pic('mymart-drill-yellow') }, { label: 'Blue', swatch: '#1F5FA8', img: pic('mymart-drill-blue') }] },
  { name: 'Cloud Linen Bedding Set', tags: ['home', 'apparel'], priceTHB: 1690, unit: 'Queen', variantLabel: 'Color', stock: 11,
    variants: [{ label: 'White', swatch: '#F4F1EA', img: pic('mymart-bedding-white') }, { label: 'Sage', swatch: '#B7C4A8', img: pic('mymart-bedding-sage') }, { label: 'Blush', swatch: '#E7C9C2', img: pic('mymart-bedding-blush') }] },
  { name: 'Pocket Power Bank 10000mAh', tags: ['electronics'], priceTHB: 590, wasTHB: 790, unit: '10000 mAh', variantLabel: 'Color', stock: 35,
    variants: [{ label: 'White', swatch: '#F0F0F0', img: pic('mymart-power-white') }, { label: 'Black', swatch: '#1E1E1E', img: pic('mymart-power-black') }] },
  { name: 'Orchard Raw Honey', tags: ['grocery'], priceTHB: 350, unit: '500 g', variantLabel: 'Size', stock: 45,
    variants: [{ label: '500 g', swatch: '#E0A12B', img: pic('mymart-honey-500') }, { label: '1 kg', swatch: '#C98A1E', img: pic('mymart-honey-1000') }] },
];

async function seed(client) {
  const prisma = client || new PrismaClient();
  const owns = !client;

  // ---- staff accounts ----
  const owner = await prisma.user.upsert({
    where: { username: 'owner' },
    update: {},
    create: { name: 'Store Owner', username: 'owner', passwordHash: await hashPassword('Owner@123'), role: ROLES.OWNER, active: true },
  });
  await prisma.user.upsert({
    where: { username: 'staff' },
    update: {},
    create: { name: 'Front Desk Staff', username: 'staff', passwordHash: await hashPassword('Staff@123'), role: ROLES.STAFF, active: true },
  });

  // ---- categories (editable; DB is source of truth after this) ----
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const c = DEFAULT_CATEGORIES[i];
    const data = { slug: c.slug, label: c.label, icon: c.icon, sortOrder: i };
    await prisma.category.upsert({ where: { slug: c.slug }, update: data, create: data });
  }

  // ---- products + variants ----
  // Each product is a grouping; its sellable SKUs are its variants. Variants are
  // upserted by their (unique, deterministic) barcode so the seed is re-runnable
  // without deleting rows that bills may reference.
  for (let i = 0; i < SOURCE.length; i++) {
    const s = SOURCE[i];
    const sku = `MM-${String(i + 1).padStart(3, '0')}`;
    const productData = {
      name: s.name,
      unit: s.unit, // "Type"
      sortOrder: i, // storefront order mirrors the catalog order
      isVisible: true,
      isActive: true,
      tagsJson: JSON.stringify(s.tags),
    };
    const product = await prisma.product.upsert({
      where: { sku },
      update: productData,
      create: { sku, ...productData },
    });

    for (let j = 0; j < s.variants.length; j++) {
      const vr = s.variants[j];
      const barcode = String(8850000000000 + i * 10 + j); // unique per product+variant
      const variantData = {
        productId: product.id,
        name: vr.label,
        imageUrl: vr.img,
        sellPriceMinor: bahtToMinor(s.priceTHB),
        sellPriceKhr: Math.round(s.priceTHB * RATES.KHR), // starting KHR price (staff can edit)
        inStock: s.stock > 0, // two of the SOURCE items start out of stock
        sortOrder: j,
      };
      await prisma.variant.upsert({ where: { barcode }, update: variantData, create: { barcode, ...variantData } });
    }
  }

  // ---- default printer ----
  const printerCount = await prisma.printerSetting.count();
  if (printerCount === 0) {
    await prisma.printerSetting.create({
      data: {
        name: 'Counter Thermal',
        paperWidth: '80mm',
        type: 'thermal',
        headerText: 'Ai Mini-Mart\n123 Market Street, Phnom Penh\nTel: 012 345 678',
        footerText: 'Thank you for shopping with Ai Mini-Mart!\nNo refunds without receipt.',
        isDefault: true,
      },
    });
  }

  console.log('\n  ✅ Seed complete.');
  console.log('  ───────────────────────────────────────────');
  console.log('   Owner →  username: owner   password: Owner@123');
  console.log('   Staff →  username: staff   password: Staff@123');
  console.log(`   Products seeded: ${SOURCE.length}`);
  console.log('  ───────────────────────────────────────────\n');

  if (owns) await prisma.$disconnect();
  return { owner };
}

module.exports = { seed, SOURCE };

// Allow `node prisma/seed.js` directly.
if (require.main === module) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
