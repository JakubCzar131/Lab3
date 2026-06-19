import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString: process.env.DATABASE_URL,
    }),
  ),
});

async function main() {
  await prisma.generatedDesign.deleteMany();
  await prisma.uploadedAsset.deleteMany();
  await prisma.moderationResult.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.shippingInfo.deleteMany();
  await prisma.consentLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();

  const tshirt = await prisma.product.create({
    data: {
      slug: "mystery-tshirt",
      name: "Nocturne Mystery T-Shirt",
      description: "Bawełniana koszulka premium pod personalizowany mystery print AI.",
      type: "TSHIRT",
      basePrice: 13900,
      variants: {
        create: [
          {
            sku: "TS-BLK-001",
            colorName: "Obsidian Black",
            colorHex: "#0B0B0E",
            availableSizes: ["S", "M", "L", "XL"],
            priceDelta: 0,
            mockupUrl: "/mockups/tshirt-black.jpg",
          },
          {
            sku: "TS-GR-002",
            colorName: "Ash Graphite",
            colorHex: "#2A2A2E",
            availableSizes: ["S", "M", "L", "XL"],
            priceDelta: 500,
            mockupUrl: "/mockups/tshirt-graphite.jpg",
          },
        ],
      },
    },
  });

  const hoodie = await prisma.product.create({
    data: {
      slug: "mystery-hoodie",
      name: "Nocturne Mystery Hoodie",
      description: "Cięższa bluza premium z personalizowanym mystery printem AI.",
      type: "HOODIE",
      basePrice: 24900,
      variants: {
        create: [
          {
            sku: "HD-BLK-001",
            colorName: "Night Black",
            colorHex: "#09090B",
            availableSizes: ["S", "M", "L", "XL", "XXL"],
            priceDelta: 0,
            mockupUrl: "/mockups/hoodie-black.jpg",
          },
          {
            sku: "HD-VLT-002",
            colorName: "Abyss Violet",
            colorHex: "#231435",
            availableSizes: ["S", "M", "L", "XL", "XXL"],
            priceDelta: 900,
            mockupUrl: "/mockups/hoodie-violet.jpg",
          },
        ],
      },
    },
  });

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH) {
    await prisma.user.upsert({
      where: { email: process.env.ADMIN_EMAIL },
      update: {
        role: Role.ADMIN,
        passwordHash: process.env.ADMIN_PASSWORD_HASH,
      },
      create: {
        email: process.env.ADMIN_EMAIL,
        role: Role.ADMIN,
        passwordHash: process.env.ADMIN_PASSWORD_HASH,
      },
    });
  }

  console.log(`Seeded products: ${tshirt.name}, ${hoodie.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
