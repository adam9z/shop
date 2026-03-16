import React, { useState, useEffect } from 'react';
import { 
  Search, 
  ArrowLeft, 
  Check, 
  Image as ImageIcon, 
  Save,
  CheckCircle2,
  AlertCircle,
  Settings,
  RefreshCw,
  LayoutTemplate,
  ExternalLink,
  Code
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Types based on our backend response
interface ProductImage {
  id: string;
  url: string;
}

interface ProductVariant {
  id: string;
  title: string;
  assignedImages: string[];
}

interface Product {
  id: string;
  title: string;
  thumbnail: string | null;
  images: ProductImage[];
  variants: ProductVariant[];
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shopDomain, setShopDomain] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'products' | 'theme'>('products');
  const [isInstallingTheme, setIsInstallingTheme] = useState(false);
  const [themeInstallMessage, setThemeInstallMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  
  // State to hold which images belong to which variant (local edits before save)
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);

  // Fetch products from Shopify via our backend
  const fetchProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch shop domain
      const shopRes = await fetch('/api/shop');
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        setShopDomain(shopData.domain);
      }

      const res = await fetch('/api/products');
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Erreur lors du chargement des produits');
      }
      
      setProducts(data.products);
      
      // Initialize assignments state from the fetched data
      const initialAssignments: Record<string, string[]> = {};
      data.products.forEach((p: Product) => {
        p.variants.forEach(v => {
          initialAssignments[v.id] = v.assignedImages || [];
        });
      });
      setAssignments(initialAssignments);
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const filteredProducts = products.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedProduct = products.find(p => p.id === selectedProductId);

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    const product = products.find(p => p.id === productId);
    if (product && product.variants.length > 0) {
      setSelectedVariantId(product.variants[0].id);
    } else {
      setSelectedVariantId(null);
    }
  };

  const handleBackToProducts = () => {
    setSelectedProductId(null);
    setSelectedVariantId(null);
  };

  const handleToggleImage = (imageId: string) => {
    if (!selectedVariantId) return;

    setAssignments(prev => {
      const currentVariantImages = prev[selectedVariantId] || [];
      const isCurrentlyAssigned = currentVariantImages.includes(imageId);
      
      let newVariantImages;
      if (isCurrentlyAssigned) {
        newVariantImages = currentVariantImages.filter(id => id !== imageId);
      } else {
        newVariantImages = [...currentVariantImages, imageId];
      }

      return {
        ...prev,
        [selectedVariantId]: newVariantImages
      };
    });
  };

  const handleThemeInstall = async () => {
    setIsInstallingTheme(true);
    setThemeInstallMessage(null);
    try {
      const res = await fetch('/api/theme/install', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur d'installation");
      setThemeInstallMessage({ type: 'success', text: data.message });
    } catch (err: any) {
      setThemeInstallMessage({ type: 'error', text: err.message });
    } finally {
      setIsInstallingTheme(false);
    }
  };

  const openThemeEditor = () => {
    if (shopDomain) {
      window.open(`https://${shopDomain}/admin/themes/current/editor?context=apps`, '_blank');
    }
  };

  const handleSave = async () => {
    if (!selectedVariantId) return;
    
    setIsSaving(true);
    try {
      const imageIdsToSave = assignments[selectedVariantId] || [];
      
      const res = await fetch('/api/variants/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: selectedVariantId,
          imageIds: imageIdsToSave
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la sauvegarde');

      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 3000);
    } catch (err: any) {
      alert(`Erreur: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const [shopUrlInput, setShopUrlInput] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('shop') || '';
  });
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopUrlInput) return;
    
    setIsConnecting(true);
    try {
      const res = await fetch(`/api/auth/url?shop=${encodeURIComponent(shopUrlInput)}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
      
      // Open Shopify OAuth screen in a popup
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      window.open(
        data.url,
        'ShopifyAuth',
        `width=${width},height=${height},top=${top},left=${left}`
      );
    } catch (err: any) {
      setError(err.message);
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Allow messages from our own domain (the popup)
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsConnecting(false);
        fetchProducts(); // Refresh data now that we have cookies
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-gray-500">
          <RefreshCw className="animate-spin text-[#008060]" size={32} />
          <p>Connexion à Shopify et chargement des produits...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f4f6f8] text-[#202223] font-sans p-4 md:p-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-[#e1e3e5] overflow-hidden">
          <div className="p-6 border-b border-[#e1e3e5] text-center">
            <div className="w-12 h-12 bg-[#f4f6f8] rounded-full flex items-center justify-center mx-auto mb-4">
              <ImageIcon size={24} className="text-[#008060]" />
            </div>
            <h1 className="text-xl font-bold text-[#202223]">Variant Images Manager</h1>
            <p className="text-[#6d7175] text-sm mt-2">
              Connectez votre boutique Shopify pour commencer à gérer les images de vos variantes.
            </p>
          </div>
          
          <div className="p-6 bg-[#f9fafb]">
            <form onSubmit={handleConnect} className="space-y-4">
              <div>
                <label htmlFor="shopUrl" className="block text-sm font-medium text-[#202223] mb-1">
                  URL de votre boutique
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="shopUrl"
                    value={shopUrlInput}
                    onChange={(e) => setShopUrlInput(e.target.value)}
                    placeholder="ma-boutique.myshopify.com"
                    className="w-full pl-3 pr-3 py-2 border border-[#c9cccf] rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent text-sm"
                    required
                  />
                </div>
                <p className="text-xs text-[#6d7175] mt-1">
                  Entrez l'URL en .myshopify.com de votre boutique.
                </p>
              </div>

              {error && error !== 'Veuillez connecter votre boutique Shopify.' && (
                <div className="bg-[#fff4f4] border border-[#d82c0d] p-3 rounded text-sm text-[#d82c0d]">
                  {error}
                </div>
              )}

              <button 
                type="submit"
                disabled={isConnecting || !shopUrlInput}
                className="w-full bg-[#008060] hover:bg-[#006e52] text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isConnecting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Connexion en cours...
                  </>
                ) : (
                  'Connecter la boutique'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-[#202223] font-sans">
      {/* Top Bar (Simulating Shopify App Header) */}
      <header className="bg-white border-b border-[#e1e3e5] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          {selectedProductId && activeTab === 'products' && (
            <button 
              onClick={handleBackToProducts}
              className="p-1.5 hover:bg-gray-100 rounded-md transition-colors text-gray-600"
              title="Retour aux produits"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h1 className="text-xl font-semibold">
            {activeTab === 'theme' ? 'Intégration au Thème' : (selectedProduct ? selectedProduct.title : 'Gestionnaire d\'Images par Variante')}
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-100 p-1 rounded-lg mr-4">
            <button
              onClick={() => setActiveTab('products')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'products' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Produits
            </button>
            <button
              onClick={() => setActiveTab('theme')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${activeTab === 'theme' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <LayoutTemplate size={16} />
              Intégration
            </button>
          </div>

          {selectedProductId && activeTab === 'products' && (
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 bg-[#008060] hover:bg-[#006e52] text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-70 shadow-sm"
            >
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save size={16} />
              )}
              Enregistrer la variante
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {activeTab === 'theme' ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto space-y-8"
          >
            <div className="bg-white p-8 rounded-xl shadow-sm border border-[#e1e3e5]">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mb-6">
                <LayoutTemplate size={24} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Afficher les images sur votre boutique</h2>
              <p className="text-gray-600 mb-8 leading-relaxed">
                Pour que seules les images sélectionnées s'affichent lorsqu'un client choisit une variante, 
                vous devez autoriser l'application à modifier l'affichage de votre thème.
              </p>

              <div className="space-y-6">
                {/* Option 1: App Embed (Standard) */}
                <div className="border border-gray-200 rounded-lg p-6 hover:border-gray-300 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 bg-gray-100 p-2 rounded-full text-gray-600">
                      <Settings size={20} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Option 1 : Activer via l'Éditeur de Thème (Recommandé)</h3>
                      <p className="text-gray-600 text-sm mb-4">
                        Ouvrez l'éditeur de thème Shopify et activez l'intégration de l'application dans les paramètres d'intégration (App Embeds).
                      </p>
                      <button 
                        onClick={openThemeEditor}
                        className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-medium hover:bg-gray-50 transition-colors"
                      >
                        <ExternalLink size={16} />
                        Ouvrir l'éditeur de thème
                      </button>
                    </div>
                  </div>
                </div>

                {/* Option 2: Auto Install */}
                <div className="border border-gray-200 rounded-lg p-6 hover:border-gray-300 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 bg-gray-100 p-2 rounded-full text-gray-600">
                      <Code size={20} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Option 2 : Installation Automatique</h3>
                      <p className="text-gray-600 text-sm mb-4">
                        L'application va injecter automatiquement le code nécessaire dans votre thème principal. 
                        Aucune action manuelle n'est requise.
                      </p>
                      
                      {themeInstallMessage && (
                        <div className={`mb-4 p-3 rounded-md text-sm flex items-start gap-2 ${themeInstallMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                          {themeInstallMessage.type === 'success' ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertCircle size={16} className="mt-0.5" />}
                          <span>{themeInstallMessage.text}</span>
                        </div>
                      )}

                      <button 
                        onClick={handleThemeInstall}
                        disabled={isInstallingTheme}
                        className="flex items-center gap-2 bg-[#008060] text-white px-4 py-2 rounded-md font-medium hover:bg-[#006e52] transition-colors disabled:opacity-70"
                      >
                        {isInstallingTheme ? (
                          <RefreshCw size={16} className="animate-spin" />
                        ) : (
                          <LayoutTemplate size={16} />
                        )}
                        Installer automatiquement
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : !selectedProductId ? (
          /* --- STEP 1: PRODUCT SELECTION --- */
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white p-6 rounded-lg shadow-sm border border-[#e1e3e5]">
              <h2 className="text-lg font-semibold mb-4">1. Sélectionnez un produit</h2>
              
              <div className="relative mb-6">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search size={18} className="text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="Rechercher des produits..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-[#c9cccf] rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-[#008060] sm:text-sm transition-colors"
                />
              </div>

              <div className="border border-[#e1e3e5] rounded-md overflow-hidden">
                <table className="min-w-full divide-y divide-[#e1e3e5]">
                  <thead className="bg-[#f9fafb]">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produit</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Variantes</th>
                      <th scope="col" className="relative px-6 py-3"><span className="sr-only">Sélectionner</span></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-[#e1e3e5]">
                    {filteredProducts.map((product) => (
                      <tr 
                        key={product.id} 
                        onClick={() => handleSelectProduct(product.id)}
                        className="hover:bg-[#f9fafb] cursor-pointer transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 border border-gray-200 rounded overflow-hidden bg-gray-50 flex items-center justify-center">
                              {product.thumbnail ? (
                                <img className="h-10 w-10 object-cover" src={product.thumbnail} alt="" referrerPolicy="no-referrer" />
                              ) : (
                                <ImageIcon size={20} className="text-gray-400" />
                              )}
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">{product.title}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                            {product.variants.length} variantes
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button className="text-[#008060] hover:text-[#006e52]">Configurer</button>
                        </td>
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-gray-500">
                          Aucun produit trouvé.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          /* --- STEP 2 & 3: VARIANT SELECTION & IMAGE ASSIGNMENT --- */
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row gap-6"
          >
            {/* Left Column: Variants List */}
            <div className="w-full md:w-1/3 space-y-4">
              <div className="bg-white rounded-lg shadow-sm border border-[#e1e3e5] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#e1e3e5] bg-[#f9fafb]">
                  <h2 className="font-semibold text-sm">2. Sélectionnez une variante</h2>
                </div>
                <ul className="divide-y divide-[#e1e3e5] max-h-[60vh] overflow-y-auto">
                  {selectedProduct?.variants.map(variant => {
                    const isSelected = selectedVariantId === variant.id;
                    const assignedCount = (assignments[variant.id] || []).length;
                    
                    return (
                      <li key={variant.id}>
                        <button
                          onClick={() => setSelectedVariantId(variant.id)}
                          className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors ${
                            isSelected ? 'bg-[#f0fdf4] border-l-4 border-[#008060]' : 'hover:bg-gray-50 border-l-4 border-transparent'
                          }`}
                        >
                          <span className={`text-sm ${isSelected ? 'font-semibold text-[#008060]' : 'text-gray-700'}`}>
                            {variant.title}
                          </span>
                          {assignedCount > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                              {assignedCount} image{assignedCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3 text-blue-800 text-sm">
                <AlertCircle size={20} className="flex-shrink-0 text-blue-500" />
                <p>
                  Les images sélectionnées ici seront enregistrées dans un <strong>Metafield Shopify</strong>. Vous devrez ajouter un petit bout de code dans votre thème pour les filtrer sur la boutique.
                </p>
              </div>
            </div>

            {/* Right Column: Image Grid */}
            <div className="w-full md:w-2/3">
              <div className="bg-white rounded-lg shadow-sm border border-[#e1e3e5] p-6">
                <div className="mb-4">
                  <h2 className="font-semibold text-lg">3. Assignez les images</h2>
                  <p className="text-sm text-gray-500">
                    Cliquez sur les images du produit pour les lier à la variante sélectionnée (<strong>{selectedProduct?.variants.find(v => v.id === selectedVariantId)?.title}</strong>). N'oubliez pas d'enregistrer.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {selectedProduct?.images.map(image => {
                    const isAssigned = selectedVariantId ? (assignments[selectedVariantId] || []).includes(image.id) : false;
                    
                    return (
                      <div 
                        key={image.id}
                        onClick={() => handleToggleImage(image.id)}
                        className={`relative aspect-square rounded-md overflow-hidden cursor-pointer border-2 transition-all ${
                          isAssigned ? 'border-[#008060] ring-2 ring-[#008060] ring-opacity-50' : 'border-transparent hover:border-gray-300'
                        }`}
                      >
                        <img 
                          src={image.url} 
                          alt="Product" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        
                        {/* Checkbox Overlay */}
                        <div className={`absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center transition-colors ${
                          isAssigned ? 'bg-[#008060] text-white' : 'bg-white border border-gray-300 text-transparent hover:border-gray-400'
                        }`}>
                          <Check size={16} strokeWidth={3} />
                        </div>
                        
                        {/* Dim unselected images slightly for better focus */}
                        {!isAssigned && (
                          <div className="absolute inset-0 bg-black/5 hover:bg-transparent transition-colors" />
                        )}
                      </div>
                    );
                  })}
                  
                  {selectedProduct?.images.length === 0 && (
                    <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                      <ImageIcon size={48} className="mb-3 opacity-50" />
                      <p>Ce produit n'a aucune image.</p>
                      <p className="text-sm mt-1">Ajoutez d'abord des images dans Shopify.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* Toast Notification */}
      <AnimatePresence>
        {showSavedToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-6 left-1/2 bg-[#202223] text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 z-50"
          >
            <CheckCircle2 size={20} className="text-[#008060]" />
            <span className="font-medium text-sm">Images enregistrées dans Shopify pour cette variante !</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

