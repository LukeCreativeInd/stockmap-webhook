import { Octokit } from "octokit";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Only POST supported");

  const { customer } = req.body;

  if (!customer?.id) return res.status(400).send("Missing customer ID");

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
    return res.status(500).send("Failed to fetch customer from Shopify");
  }

  const { customer: c } = await shopifyRes.json();

  const row = `"${c.first_name} ${c.last_name}","${c.default_address?.address1 || ""}","${c.default_address?.city || ""}","${c.default_address?.province || ""}","${c.default_address?.zip || ""}","${c.default_address?.country || ""}","${c.phone || ""}"`;

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const [owner, repo] = process.env.CSV_REPO.split("/");
  const path = process.env.CSV_PATH;

  try {
    // Get the current file contents
    const { data: fileData } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: process.env.CSV_BRANCH,
    });

    const csvContent = Buffer.from(fileData.content, "base64").toString();

    // Avoid duplicates (match on name or address)
    if (csvContent.includes(c.default_address?.address1 || "")) {
      return res.status(200).send("Customer already in CSV");
    }

    const newContent = csvContent.trim() + "\n" + row;

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Add stockist: ${c.first_name} ${c.last_name}`,
      content: Buffer.from(newContent).toString("base64"),
      sha: fileData.sha,
      branch: process.env.CSV_BRANCH,
    });

    return res.status(200).send("Customer added to CSV");
  } catch (error) {
    console.error("GitHub CSV update error:", error);
    return res.status(500).send("GitHub update failed");
  }
}
