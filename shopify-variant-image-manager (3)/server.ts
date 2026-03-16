import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cookieParser from 'cookie-parser';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // --- SHOPIFY API HELPERS ---
  const getShopifyHeaders = (req: any) => {
    let domain = req.cookies.shopify_shop || process.env.SHOPIFY_STORE_DOMAIN;
    const token = req.cookies.shopify_token || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!domain || !token) throw new Error('MISSING_CREDENTIALS');
    
    // Sanitize domain: remove http://, https://, and trailing slashes
    domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    return { domain, token };
  };

  const shopifyGraphQL = async (req: any, query: string, variables: any = {}) => {
    const { domain, token } = getShopifyHeaders(req);
    const url = `https://${domain}/admin/api/2024-01/graphql.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await response.text();
    try {
      const data = JSON.parse(text);
      if (data.errors) {
        console.error('Shopify GraphQL Errors:', data.errors);
        throw new Error(data.errors[0].message);
      }
      return data.data;
    } catch (e: any) {
      if (e.name === 'SyntaxError') {
        throw new Error(`Le domaine Shopify configuré ("${domain}") semble incorrect ou inaccessible.`);
      }
      throw e;
    }
  };

  const shopifyREST = async (req: any, method: string, endpoint: string, body?: any) => {
    const { domain, token } = getShopifyHeaders(req);
    const url = `https://${domain}/admin/api/2024-01/${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      if (!response.ok) {
        console.error('Shopify REST Error:', data);
        throw new Error(data.errors ? JSON.stringify(data.errors) : 'Erreur API Shopify');
      }
      return data;
    } catch (e: any) {
      if (e.name === 'SyntaxError') {
        throw new Error(`Le domaine Shopify configuré ("${domain}") semble incorrect ou inaccessible.`);
      }
      throw e;
    }
  };

  // --- OAUTH ROUTES ---
  app.get('/api/auth/url', (req, res) => {
    let shop = req.query.shop as string;
    if (!shop) return res.status(400).json({ error: 'Shop is required' });
    
    shop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!shop.includes('.myshopify.com')) {
      shop = `${shop}.myshopify.com`;
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'SHOPIFY_CLIENT_ID is not configured in environment variables.' });

    const scopes = 'read_products,write_products,read_themes,write_themes';
    // Use the dynamic APP_URL provided by AI Studio
    const redirectUri = `${process.env.APP_URL}/api/auth/callback`;

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.json({ url: authUrl });
  });

  app.get('/api/auth/callback', async (req, res) => {
    const { shop, code } = req.query;
    if (!shop || !code) return res.status(400).send('Missing shop or code');

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    try {
      const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || 'Failed to get token');

      // Set cookies for iframe context
      res.cookie('shopify_shop', shop, {
        secure: true,
        sameSite: 'none',
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
      res.cookie('shopify_token', data.access_token, {
        secure: true,
        sameSite: 'none',
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000
      });

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentification réussie. Cette fenêtre va se fermer.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error('OAuth Error:', error);
      res.status(500).send(`Erreur d'authentification: ${error.message}`);
    }
  });

  // --- API ROUTES ---

  app.get('/api/shop', (req, res) => {
    res.json({ domain: req.cookies.shopify_shop || process.env.SHOPIFY_STORE_DOMAIN || '' });
  });

  // 1. Get all products with their variants and images
  app.get('/api/products', async (req, res) => {
    try {
      const query = `
        query {
          products(first: 50) {
            edges {
              node {
                id
                title
                featuredImage { url }
                images(first: 20) {
                  edges {
                    node { id url }
                  }
                }
                variants(first: 50) {
                  edges {
                    node {
                      id
                      title
                      metafield(namespace: "custom", key: "variant_images") {
                        id
                        value
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const data = await shopifyGraphQL(req, query);
      
      // Transform Shopify GraphQL response into a simpler format for the frontend
      const products = data.products.edges.map((pEdge: any) => {
        const p = pEdge.node;
        return {
          id: p.id,
          title: p.title,
          thumbnail: p.featuredImage?.url || null,
          images: p.images.edges.map((iEdge: any) => ({
            id: iEdge.node.id,
            url: iEdge.node.url
          })),
          variants: p.variants.edges.map((vEdge: any) => {
            const v = vEdge.node;
            let assignedImages: string[] = [];
            if (v.metafield && v.metafield.value) {
              try {
                assignedImages = JSON.parse(v.metafield.value);
              } catch (e) {
                console.error('Failed to parse metafield JSON', e);
              }
            }
            return {
              id: v.id,
              title: v.title,
              assignedImages
            };
          })
        };
      });

      res.json({ products });
    } catch (error: any) {
      if (error.message === 'MISSING_CREDENTIALS') {
        res.status(401).json({ error: 'Veuillez connecter votre boutique Shopify.' });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // 2. Save assigned images to a variant's metafield
  app.post('/api/variants/images', async (req, res) => {
    try {
      const { variantId, imageIds } = req.body;

      if (!variantId || !Array.isArray(imageIds)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      // We store the array of image IDs as a JSON string in a metafield
      const jsonValue = JSON.stringify(imageIds);

      const mutation = `
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        metafields: [
          {
            ownerId: variantId,
            namespace: "custom",
            key: "variant_images",
            type: "json",
            value: jsonValue
          }
        ]
      };

      const data = await shopifyGraphQL(req, mutation, variables);

      if (data.metafieldsSet.userErrors && data.metafieldsSet.userErrors.length > 0) {
        throw new Error(data.metafieldsSet.userErrors[0].message);
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 3. Auto-install theme snippet (No-code integration)
  app.post('/api/theme/install', async (req, res) => {
    try {
      // Step 1: Get main theme ID
      const themesData = await shopifyREST(req, 'GET', 'themes.json');
      const mainTheme = themesData.themes.find((t: any) => t.role === 'main');
      if (!mainTheme) throw new Error('Aucun thème principal trouvé.');

      // Step 2: Create the liquid snippet
      const snippetContent = `
{% if template contains 'product' %}
<script>
  document.addEventListener('DOMContentLoaded', function() {
    const variantImages = {
      {% for variant in product.variants %}
        "{{ variant.id }}": {{ variant.metafields.custom.variant_images.value | json | default: '[]' }}{% unless forloop.last %},{% endunless %}
      {% endfor %}
    };

    function filterImages(variantId) {
      // Shopify variant IDs in JS are usually numeric, but our map uses gid://...
      // Let's normalize keys to numeric IDs
      const normalizedMap = {};
      Object.keys(variantImages).forEach(key => {
        const numId = key.split('/').pop();
        normalizedMap[numId] = variantImages[key];
      });

      const allowedIds = normalizedMap[variantId];
      if (!allowedIds || allowedIds.length === 0) return; // Show all if none assigned

      const numericAllowedIds = allowedIds.map(id => id.split('/').pop());
      const mediaItems = document.querySelectorAll('.product__media-item, .thumbnail-list__item');
      
      mediaItems.forEach(item => {
        const mediaId = item.getAttribute('data-media-id') || item.dataset.mediaId;
        if (mediaId) {
          const numericMediaId = mediaId.replace(/\\D/g, '');
          const isAllowed = numericAllowedIds.some(id => numericMediaId.includes(id) || id.includes(numericMediaId));
          item.style.display = isAllowed ? '' : 'none';
        }
      });
    }

    // Initial filter
    const urlParams = new URLSearchParams(window.location.search);
    const initialVariant = urlParams.get('variant') || "{{ product.selected_or_first_available_variant.id }}";
    if (initialVariant) filterImages(initialVariant);

    // Listen for variant changes (URL changes)
    let lastUrl = location.href; 
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        const newVariant = new URLSearchParams(window.location.search).get('variant');
        if (newVariant) filterImages(newVariant);
      }
    }).observe(document, {subtree: true, childList: true});
  });
</script>
{% endif %}
      `;

      await shopifyREST(req, 'PUT', `themes/${mainTheme.id}/assets.json`, {
        asset: { key: 'snippets/variant-image-filter.liquid', value: snippetContent }
      });

      // Step 3: Inject into theme.liquid
      const themeLiquidData = await shopifyREST(req, 'GET', `themes/${mainTheme.id}/assets.json?asset[key]=layout/theme.liquid`);
      let themeContent = themeLiquidData.asset.value;

      if (!themeContent.includes("{% render 'variant-image-filter' %}")) {
        themeContent = themeContent.replace('</body>', "  {% render 'variant-image-filter' %}\n</body>");
        await shopifyREST(req, 'PUT', `themes/${mainTheme.id}/assets.json`, {
          asset: { key: 'layout/theme.liquid', value: themeContent }
        });
      }

      res.json({ success: true, message: 'Code injecté avec succès dans le thème.' });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Erreur lors de l'installation du thème." });
    }
  });

  // --- VITE MIDDLEWARE (for development) ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
