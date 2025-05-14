import { Octokit } from "octokit";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).end("Only POST supported");

    const { customer } = req.body;
    if (!customer?.id) return res.status(400).send("Missing customer ID");

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

    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    const address = (c.default_address?.address1 || "").toLowerCase();

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.CSV_REPO.split("/");
    const path = process.env.CSV_PATH;

    const { data: fileData } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: process.env.CSV_BRANCH,
    });

    const csvContent = Buffer.from(fileData.content, "base64").toString();
    const rows = csvContent.split("\n");

    const filtered = rows.filter(row => {
      const lowerRow = row.toLowerCase();
      return !(
        lowerRow.includes(fullName) ||
        lowerRow.includes(address)
      );
    });

    const newCsv = filtered.join("\n").trim();

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Remove stockist: ${fullName}`,
      content: Buffer.from(newCsv).toString("base64"),
      sha: fileData.sha,
      branch: process.env.CSV_BRANCH,
    });

    return res.status(200).send("Customer removed from CSV");
  } catch (error) {
    console.error("💥 Top-level crash in remove.js:", error.message || error);
    return res.status(500).send("Top-level crash occurred");
  }
}
