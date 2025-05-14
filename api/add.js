// api/add.js
import { Octokit } from "octokit";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).end("Only POST supported");

    const rawBody = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", chunk => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", err => reject(err));
    });

    const parsed = JSON.parse(rawBody);
    const { customer } = parsed;

    if (!customer?.id) {
      console.error("🚨 Missing customer ID in parsed body:", parsed);
      return res.status(400).send("Missing customer ID");
    }

    console.log("✅ Parsed customer ID:", customer.id);

    // Fetch customer details from Shopify Admin API
    const shopifyRes = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/customers/${customer.id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    if (!shopifyRes.ok) {
      const text = await shopifyRes.text();
      console.error("💥 Shopify fetch failed:", text);
      return res.status(500).send("Shopify fetch failed");
    }

    const { customer: c } = await shopifyRes.json();

    const companyName = c.company || `${c.first_name} ${c.last_name}`;
    const address1 = c.default_address?.address1 || "";
    const city = c.default_address?.city || "";
    const state = c.default_address?.province || "";
    const postcode = c.default_address?.zip || "";
    const country = c.default_address?.country || "Australia";
    const phone = c.phone || "";
    const email = c.email || "";
    const fullAddress = `${address1}, ${city}, ${postcode}, ${state}`;

    const row = `"${companyName}","${address1}","${city}","${state}","${postcode}","${country}","${phone}","${email}","${fullAddress}"`;

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.CSV_REPO.split("/");
    const path = process.env.CSV_PATH;

    // Get current file content
    const { data: current } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: process.env.CSV_BRANCH,
    });

    const csv = Buffer.from(current.content, "base64").toString();

    if (csv.includes(email)) {
      console.log("ℹ️ Customer already exists in CSV");
      return res.status(200).send("Customer already exists");
    }

    const newCsv = csv.trim() + "\n" + row;

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Add stockist: ${companyName}`,
      content: Buffer.from(newCsv).toString("base64"),
      sha: current.sha,
      branch: process.env.CSV_BRANCH,
    });

    console.log("✅ Customer added to CSV");
    return res.status(200).send("Customer added to CSV");
  } catch (error) {
    console.error("💥 Top-level crash in add.js:", error.stack || error.message || error);
    return res.status(500).send("Top-level crash occurred");
  }
}
