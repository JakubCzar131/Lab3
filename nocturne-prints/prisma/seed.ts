import crypto from "node:crypto";
import { PrismaClient, ProductType } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const SIZES = ["S", "M", "L", "XL", "XXL"];

const COLORS = [
  { color: "Onyx", colorHex: "#0a0a0a" },
  { color: "Graphite", colorHex: "#2a2a30" },
  { color: "Deep Violet", colorHex: "#2a1840" },
  { color: "Ash", colorHex: "#6b6b72" },
];

async function main() {
  console.log("Seedowanie bazy Nocturne Prints...");

  // --- Admin ---
  const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@nocturne.local").toLowerCase();
  const adminPasswordHash =
    process.env.ADMIN_PASSWORD_HASH ?? hashPassword(process.env.ADMIN_PASSWORD ?? "change-me-now");

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminPasswordHash, role: "ADMIN" },
    create: { email: adminEmail, passwordHash: adminPasswordHash, role: "ADMIN" },
  });
  console.log(`  Admin: ${adminEmail}`);

  // --- Produkty ---
  const products = [
    {
      slug: "koszulka-nocturne",
      name: "Koszulka Nocturne",
      type: ProductType.TSHIRT,
      basePrice: 12900, // 129,00 zl
      description:
        "Ciężka bawełna premium, krój regular. Nośnik dla Twojego jednorazowego rytuału nadruku.",
      mockupUrl: "/mockups/tshirt.svg",
    },
    {
      slug: "bluza-nocturne",
      name: "Bluza Nocturne",
      type: ProductType.HOODIE,
      basePrice: 24900, // 249,00 zl
      description:
        "Gruba bluza z kapturem, miękkie wnętrze, mroczny minimalizm. Idealna pod większe kompozycje.",
      mockupUrl: "/mockups/hoodie.svg",
    },
  ];

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        type: p.type,
        basePrice: p.basePrice,
        description: p.description,
        mockupUrl: p.mockupUrl,
        active: true,
      },
      create: { ...p, active: true },
    });

    for (const c of COLORS) {
      for (const size of SIZES) {
        const sku = `${p.slug}-${c.color}-${size}`.toLowerCase().replace(/\s+/g, "-");
        // priceDiff: wieksze rozmiary +10 zl od XL wzwyz
        const priceDiff = size === "XXL" ? 1000 : 0;
        await prisma.productVariant.upsert({
          where: { sku },
          update: { colorHex: c.colorHex, priceDiff, stock: 100 },
          create: {
            productId: product.id,
            color: c.color,
            colorHex: c.colorHex,
            size,
            sku,
            priceDiff,
            stock: 100,
          },
        });
      }
    }
    console.log(`  Produkt: ${p.name} (${COLORS.length * SIZES.length} wariantów)`);
  }

  console.log("Seed zakończony.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
