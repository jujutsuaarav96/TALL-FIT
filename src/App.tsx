import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronRight, 
  Ruler, 
  Shirt, 
  Sparkles, 
  CheckCircle2, 
  Loader2, 
  X,
  ArrowRight,
  Info,
  Upload,
  Camera,
  RefreshCw,
  Download,
  Cloud,
  Image as ImageIcon,
  LogIn,
  LogOut,
  User as UserIcon,
  Plus,
  ExternalLink,
  Search,
  Heart,
  MessageSquare,
  Star
} from 'lucide-react';
import Markdown from 'react-markdown';
import { 
  getFashionRecommendations, 
  estimateMeasurementsFromImage,
  generateVirtualTryOn,
  chatWithStylist
} from './services/geminiService';
import { RecommendationRequest, RecommendationResponse } from './types';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  onAuthStateChanged, 
  User,
  doc,
  setDoc,
  getDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  addDoc,
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  where,
  deleteDoc
} from './firebase';

import DOMPurify from 'dompurify';

// --- Constants ---
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const RATE_LIMIT_MS = 2000; // 2 seconds between AI calls

// --- Affiliate Configuration ---
// TO EARN MONEY: Sign up for affiliate programs at these brands and add your IDs here.
const AFFILIATE_CONFIG: Record<string, string> = {
  'American Tall': 'YOUR_ID_HERE',
  'ASOS Tall': 'YOUR_ID_HERE',
  '2Tall': 'YOUR_ID_HERE'
};

const getAffiliateLink = (brandName: string, baseUrl: string) => {
  const affId = AFFILIATE_CONFIG[brandName];
  if (!affId || affId === 'YOUR_ID_HERE') return baseUrl;
  
  // Example for brands that use query params
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}aff_id=${affId}`;
};

// --- Types ---
interface GalleryPost {
  id: string;
  uid: string;
  userName: string;
  userPhoto: string;
  imageUrl: string;
  caption: string;
  height: string;
  brands: string[];
  createdAt: any;
}

interface Brand {
  id: string;
  name: string;
  url: string;
  description: string;
  maxInseam: string;
  priceRange: '$' | '$$' | '$$$';
  categories: string[];
  logoUrl: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    height: '',
    weight: '',
    build: '',
    inseam: '',
    shoulderWidth: '',
    stylePreference: 'Casual',
    occasion: 'Daily Wear'
  });

  const [tryOnImage, setTryOnImage] = useState<string | null>(null);
  const [tryOnResult, setTryOnResult] = useState<string | null>(null);
  const [tryOnLoading, setTryOnLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [tryOnPrompt, setTryOnPrompt] = useState('');

  const [galleryPosts, setGalleryPosts] = useState<GalleryPost[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isGalleryLoading, setIsGalleryLoading] = useState(true);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [lastAiCall, setLastAiCall] = useState(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // --- Auth & Profile ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        // Load profile
        try {
          const profileDoc = await getDoc(doc(db, 'profiles', currentUser.uid));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            setFormData({
              height: data.height || '',
              weight: data.weight || '',
              build: data.build || '',
              inseam: data.inseam || '',
              shoulderWidth: data.shoulderWidth || '',
              stylePreference: data.style || 'Casual',
              occasion: 'Daily Wear'
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `profiles/${currentUser.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // --- Favorites Listener ---
  useEffect(() => {
    if (!user) {
      setFavorites([]);
      return;
    }

    const q = query(collection(db, 'favorites'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'));
    const unsubscribeFavorites = onSnapshot(q, (snapshot) => {
      const favs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFavorites(favs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'favorites');
    });

    return () => unsubscribeFavorites();
  }, [user]);

  // --- Data Fetching ---
  useEffect(() => {
    // Gallery
    const q = query(collection(db, 'gallery'), orderBy('createdAt', 'desc'), limit(12));
    const unsubscribeGallery = onSnapshot(q, (snapshot) => {
      const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GalleryPost));
      setGalleryPosts(posts);
      setIsGalleryLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'gallery');
    });

    // Brands (Static for now, could be from DB)
    const initialBrands: Brand[] = [
      {
        id: '1',
        name: 'American Tall',
        url: 'https://americantall.com',
        description: 'Specifically engineered for men 6\'3" to 7\'1" and women 5\'9" to 6\'6".',
        maxInseam: '40"',
        priceRange: '$$',
        categories: ['Basics', 'Denim', 'Activewear'],
        logoUrl: 'https://picsum.photos/seed/at/200/100'
      },
      {
        id: '2',
        name: 'ASOS Tall',
        url: 'https://www.asos.com',
        description: 'Trendy fashion with a dedicated tall line for both men and women.',
        maxInseam: '38"',
        priceRange: '$',
        categories: ['Fashion', 'Occasion', 'Streetwear'],
        logoUrl: 'https://picsum.photos/seed/asos/200/100'
      },
      {
        id: '3',
        name: '2Tall',
        url: 'https://www.2tall.com',
        description: 'UK-based specialist for tall men, shipping worldwide.',
        maxInseam: '40"',
        priceRange: '$$$',
        categories: ['Smart', 'Casual', 'Shoes'],
        logoUrl: 'https://picsum.photos/seed/2tall/200/100'
      }
    ];
    setBrands(initialBrands);

    return () => {
      unsubscribeGallery();
    };
  }, []);

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error("Login Error:", err);
        alert("An error occurred during sign-in. Please try again.");
      }
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'profiles', user.uid), {
        uid: user.uid,
        height: formData.height,
        weight: formData.weight,
        build: formData.build,
        inseam: formData.inseam,
        shoulderWidth: formData.shoulderWidth,
        style: formData.stylePreference,
        updatedAt: serverTimestamp()
      });
      alert("Profile saved successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `profiles/${user.uid}`);
    }
  };

  const handleDownloadBackup = () => {
    const data = {
      profile: formData,
      favorites: favorites,
      exportDate: new Date().toISOString(),
      app: "TallFit"
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tallfit-backup-${user?.uid || 'guest'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePostToGallery = async (imageUrl: string, brands: string[] = []) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'gallery'), {
        uid: user.uid,
        userName: user.displayName || 'TallFit User',
        userPhoto: user.photoURL || '',
        imageUrl: imageUrl,
        caption: `My latest fit at ${formData.height}`,
        height: formData.height,
        brands: brands,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'gallery');
    }
  };

  const handleGalleryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && user) {
      if (file.size > MAX_FILE_SIZE) {
        alert("File too large. Max size is 5MB.");
        return;
      }
      const brandInput = prompt("What brands are you wearing? (comma separated)");
      const brands = brandInput ? brandInput.split(',').map(b => b.trim().substring(0, 50)) : [];
      
      const reader = new FileReader();
      reader.onloadend = () => {
        handlePostToGallery(reader.result as string, brands);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleFavorite = async (outfit: any) => {
    if (!user) return;
    const existing = favorites.find(f => f.title === outfit.title);
    if (existing) {
      try {
        await deleteDoc(doc(db, 'favorites', existing.id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `favorites/${existing.id}`);
      }
    } else {
      try {
        await addDoc(collection(db, 'favorites'), {
          uid: user.uid,
          ...outfit,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'favorites');
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        alert("File too large. Max size is 5MB.");
        return;
      }
      setIsUploading(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        setTryOnImage(reader.result as string);
        setIsUploading(false);
      };
      reader.onerror = () => {
        setIsUploading(false);
        alert("Failed to read file.");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTryOn = async () => {
    if (!tryOnImage || !tryOnPrompt) return;
    
    const now = Date.now();
    if (now - lastAiCall < RATE_LIMIT_MS) {
      setError("Please wait a moment before generating again.");
      return;
    }
    setLastAiCall(now);

    setTryOnLoading(true);
    try {
      const base64Image = tryOnImage.split(',')[1];
      const mimeType = tryOnImage.split(';')[0].split(':')[1];

      const imageUrl = await generateVirtualTryOn(base64Image, mimeType, tryOnPrompt);
      setTryOnResult(imageUrl);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate try-on.");
    } finally {
      setTryOnLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const now = Date.now();
    if (now - lastAiCall < RATE_LIMIT_MS) {
      setError("Please wait a moment before requesting again.");
      return;
    }
    setLastAiCall(now);

    setLoading(true);
    setError(null);
    try {
      const req: RecommendationRequest = {
        measurements: {
          height: formData.height,
          weight: formData.weight,
          inseam: formData.inseam,
          shoulderWidth: formData.shoulderWidth
        },
        stylePreference: formData.stylePreference,
        occasion: formData.occasion
      };
      const res = await getFashionRecommendations(req);
      setRecommendations(res);
      setIsChatOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen selection:bg-accent/30 bg-bg text-text">
      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-16 py-8 bg-bg/80 backdrop-blur-md border-b border-border">
        <div className="font-serif text-3xl tracking-tight text-text">TallFit</div>
        <div className="flex items-center gap-8">
          <div className="hidden md:flex gap-8 text-[10px] tracking-widest uppercase font-bold text-muted">
            <button onClick={() => scrollToSection('try-on')} className="hover:text-accent transition-colors">Try-On</button>
            <button onClick={() => scrollToSection('brands')} className="hover:text-accent transition-colors">Brands</button>
            <button onClick={() => scrollToSection('gallery')} className="hover:text-accent transition-colors">Gallery</button>
          </div>
          
          {isAuthReady && user && (
            <div className="flex items-center gap-4">
              <button 
                onClick={handleDownloadBackup}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-text text-bg text-[10px] tracking-widest uppercase font-bold hover:bg-accent transition-all rounded-full"
              >
                <Cloud className="w-3 h-3" />
                Back up now
              </button>
              <button 
                onClick={() => setIsFavoritesOpen(true)}
                className="relative p-2 text-muted hover:text-text transition-colors"
              >
                <Heart className={`w-5 h-5 ${favorites.length > 0 ? 'fill-accent text-accent' : ''}`} />
                {favorites.length > 0 && (
                  <span className="absolute top-0 right-0 w-3 h-3 bg-accent text-bg text-[7px] flex items-center justify-center rounded-full font-bold">
                    {favorites.length}
                  </span>
                )}
              </button>
            </div>
          )}

          <div className="h-6 w-px bg-border hidden md:block" />

          {isAuthReady && (
            user ? (
              <div className="flex items-center gap-4">
                <div className="hidden md:block text-right">
                  <p className="text-[10px] font-bold text-text leading-none">{user.displayName}</p>
                  <button onClick={logout} className="text-[9px] text-accent hover:underline uppercase tracking-tighter">Sign Out</button>
                </div>
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-border" />
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-6 py-3 bg-text text-bg text-[10px] tracking-widest uppercase font-bold hover:bg-accent transition-colors"
              >
                <LogIn className="w-3 h-3" />
                Sign In
              </button>
            )
          )}
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-screen grid lg:grid-cols-2 items-center px-6 md:px-16 pt-32 pb-16 gap-16 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&q=80&w=2000" 
            alt="Hero Background" 
            className="w-full h-full object-cover opacity-5 grayscale"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/95 to-transparent" />
        </div>
        <div className="absolute -top-[20%] -right-[10%] w-[55vw] h-[85vh] hero-gradient pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative z-10"
        >
          <p className="text-[11px] tracking-[0.2em] uppercase text-accent mb-6 font-medium">AI-Powered Fashion for Tall People</p>
          <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl font-light leading-[1.1] tracking-tight text-text mb-8">
            Style that <em className="italic text-accent not-italic">actually</em> fits your body.
          </h1>
          <p className="text-lg text-muted max-w-md leading-relaxed mb-10">
            Most clothes are designed for average bodies. TallFit uses your exact measurements to recommend outfits built for how you're proportioned.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={() => scrollToSection('try')}
              className="px-8 py-5 bg-text text-bg text-[12px] tracking-[0.2em] uppercase font-serif font-light hover:bg-accent transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Get Your Recommendations
            </button>
            <button 
              onClick={() => scrollToSection('brands')}
              className="px-8 py-5 bg-smoke text-text border border-border text-[12px] tracking-[0.2em] uppercase font-serif font-light hover:bg-accent hover:text-bg hover:border-accent transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Explore Brands
            </button>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.3 }}
          className="hidden lg:flex justify-center items-center"
        >
          <div className="bg-card border border-border p-10 w-full max-w-sm relative shadow-sm group">
            <div className="absolute -top-2 -left-2 w-full h-full border border-accent opacity-30 pointer-events-none transition-transform group-hover:translate-x-1 group-hover:translate-y-1" />
            <div className="text-[10px] tracking-[0.15em] uppercase text-muted mb-8">Your Fit Profile</div>
            
            {[
              { label: 'Height', value: formData.height || "Not set" },
              { label: 'Inseam', value: formData.inseam || "Not set" },
              { label: 'Build', value: formData.build || "Not set" },
              { label: 'Style Match', value: <span className="px-3 py-1 bg-accent/10 text-accent-dark text-[9px] tracking-wider uppercase">{formData.stylePreference}</span> },
            ].map((stat, i) => (
              <div key={i} className="flex justify-between items-center py-4 border-b border-border last:border-0 last:pb-0">
                <span className="text-[10px] tracking-wider uppercase text-muted">{stat.label}</span>
                <span className="font-serif text-lg font-medium">{stat.value}</span>
              </div>
            ))}

            {user && (
              <div className="flex gap-2 mt-8">
                <button 
                  onClick={handleSaveProfile}
                  className="flex-1 py-3 border border-accent text-accent text-[10px] tracking-widest uppercase font-bold hover:bg-accent hover:text-bg transition-colors"
                >
                  Save Profile
                </button>
                <button 
                  onClick={handleDownloadBackup}
                  className="px-3 py-3 border border-border text-muted text-[10px] tracking-widest uppercase font-bold hover:bg-border hover:text-white transition-colors"
                  title="Download Data Backup"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </section>

      {/* PRECISION AT SCALE */}
      <section className="relative min-h-[80vh] flex items-center px-6 md:px-16 py-32 overflow-hidden bg-text">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&q=80&w=2000" 
            alt="Precision Background" 
            className="w-full h-full object-cover opacity-40 grayscale"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-text/90 via-text/40 to-text/90" />
        </div>
        
        <div className="max-w-7xl mx-auto relative z-10 w-full">
          <div className="text-center mb-20">
            <div className="flex justify-center mb-8">
              <div className="font-serif text-4xl tracking-tight text-white">TallFit</div>
            </div>
            <p className="text-[11px] tracking-[0.5em] uppercase text-accent mb-8 font-bold">The Gold Standard for Height</p>
            <h2 className="font-serif text-7xl md:text-9xl lg:text-[12rem] text-white mb-12 leading-[0.85] tracking-tighter">
              Precision <br /> <em className="italic font-light">at Scale</em>
            </h2>
            <p className="text-white/60 text-[11px] tracking-[0.3em] uppercase max-w-2xl mx-auto leading-relaxed mb-16">
              Curating elite collections from American Tall, ASOS Tall, and 2Tall.
            </p>
            
            <div className="flex flex-col sm:flex-row justify-center gap-6 max-w-2xl mx-auto">
              <button 
                onClick={() => scrollToSection('brands')}
                className="flex-1 px-10 py-6 bg-accent text-text text-[12px] tracking-[0.3em] uppercase font-bold hover:bg-white transition-all"
              >
                Shop Brands
              </button>
              <button 
                onClick={() => scrollToSection('try')}
                className="flex-1 px-10 py-6 border border-white/30 text-white text-[12px] tracking-[0.3em] uppercase font-bold hover:bg-white hover:text-text transition-all"
              >
                Fit Guide
              </button>
            </div>
          </div>
          
          <div className="grid md:grid-cols-3 gap-12 mt-32">
            {[
              { 
                step: '01', 
                title: 'Input Data', 
                desc: 'Provide your height, inseam, and build. Our AI handles the rest.',
                icon: <Ruler className="w-6 h-6" />
              },
              { 
                step: '02', 
                title: 'AI Matching', 
                desc: 'We scan thousands of items from tall-specific brands to find your match.',
                icon: <Sparkles className="w-6 h-6" />
              },
              { 
                step: '03', 
                title: 'Shop Fit', 
                desc: 'Browse recommendations that are guaranteed to fit your unique proportions.',
                icon: <Shirt className="w-6 h-6" />
              }
            ].map((item, i) => (
              <div key={i} className="relative group p-8 border border-white/10 bg-white/5 backdrop-blur-sm hover:border-accent transition-all">
                <div className="text-[80px] font-serif text-accent/10 absolute -top-12 -left-4 group-hover:text-accent/20 transition-colors">{item.step}</div>
                <div className="relative z-10">
                  <div className="w-12 h-12 border border-accent/30 flex items-center justify-center text-accent mb-6 group-hover:bg-accent group-hover:text-bg transition-all">
                    {item.icon}
                  </div>
                  <h3 className="font-serif text-2xl mb-4 text-white">{item.title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STYLING FORM */}
      <section id="try" className="px-6 md:px-16 py-24 bg-bg border-t border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-4xl md:text-6xl font-light text-text mb-4">Get Your Recommendations</h2>
            <p className="text-muted text-sm uppercase tracking-widest">Personalized AI Styling for your frame</p>
          </div>

          <StyleQuiz 
            formData={formData} 
            setFormData={setFormData} 
            onSubmit={handleSubmit} 
            loading={loading} 
          />
        </div>
      </section>

      {/* VIRTUAL TRY-ON */}
      <section id="try-on" className="px-6 md:px-16 py-20 bg-bg border-y border-border">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-end gap-8 mb-12">
            <div className="max-w-2xl">
              <p className="text-[10px] tracking-[0.3em] uppercase text-accent mb-3 font-bold">THE FUTURE OF FITTING</p>
              <h2 className="font-serif text-4xl md:text-5xl font-light leading-tight text-text">
                Virtual <em className="italic text-accent not-italic">Try-On</em> Studio.
              </h2>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8 items-stretch">
            {/* Step 1 */}
            <div className="bg-white border border-border p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-xl">1. Base Photo</h3>
                <span className="text-[9px] tracking-widest uppercase text-muted">Required</span>
              </div>
              <div 
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`flex-1 border border-dashed border-border min-h-[300px] flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-accent transition-all group overflow-hidden relative bg-smoke ${isUploading ? 'cursor-wait' : ''}`}
              >
                {tryOnImage ? (
                  <img src={tryOnImage} alt="Preview" className={`w-full h-full object-contain ${isUploading ? 'opacity-50' : ''}`} />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className={`w-6 h-6 text-muted group-hover:text-accent transition-colors ${isUploading ? 'animate-pulse' : ''}`} />
                    <span className="text-[9px] tracking-widest uppercase text-muted">Upload Frame</span>
                  </div>
                )}
                {isUploading && (
                  <div className="absolute inset-0 bg-bg/40 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 text-accent animate-spin" />
                    <span className="text-[8px] tracking-widest uppercase font-bold text-accent">Processing...</span>
                  </div>
                )}
              </div>
              <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
            </div>

            {/* Step 2 */}
            <div className="bg-white border border-border p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-xl">2. Style Intent</h3>
                <Sparkles className="w-3 h-3 text-accent" />
              </div>
              <div className="flex-1 flex flex-col">
                <textarea
                  value={tryOnPrompt}
                  onChange={(e) => setTryOnPrompt(e.target.value)}
                  placeholder="Describe the outfit you want to see on your frame..."
                  className="flex-1 w-full bg-smoke border border-border p-4 text-xs focus:outline-none focus:border-accent transition-colors resize-none mb-6 font-sans min-h-[200px]"
                />
                <button
                  onClick={handleTryOn}
                  disabled={!tryOnImage || !tryOnPrompt || tryOnLoading}
                  className="w-full py-4 bg-text text-bg text-[10px] tracking-[0.2em] uppercase font-serif font-light hover:bg-accent transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {tryOnLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Tailor Preview
                </button>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-white border border-border p-6 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-xl">3. AI Visualization</h3>
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  <span className="text-[9px] tracking-widest uppercase text-muted font-bold">Live Preview</span>
                </div>
              </div>
              <div className="flex-1 border border-border bg-smoke min-h-[300px] flex items-center justify-center relative overflow-hidden group">
                {tryOnResult ? (
                  <motion.img 
                    initial={{ opacity: 0, scale: 1.05 }}
                    animate={{ opacity: 1, scale: 1 }}
                    src={tryOnResult} 
                    alt="Result" 
                    className="w-full h-full object-contain" 
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4 opacity-20">
                    <ImageIcon className="w-16 h-16 text-text" />
                    <span className="text-[10px] tracking-[0.3em] uppercase font-bold">Awaiting Input</span>
                  </div>
                )}
                
                {tryOnLoading && (
                  <div className="absolute inset-0 bg-bg/60 backdrop-blur-md flex flex-col items-center justify-center gap-6 z-20">
                    <div className="relative">
                      <Loader2 className="w-12 h-12 text-accent animate-spin" />
                      <Sparkles className="w-4 h-4 text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="flex flex-col items-center gap-3">
                      <span className="text-[10px] tracking-[0.3em] uppercase font-bold text-accent animate-pulse">AI Tailoring...</span>
                      <div className="w-48 h-0.5 bg-border rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ x: "-100%" }}
                          animate={{ x: "100%" }}
                          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                          className="w-full h-full bg-accent"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {tryOnResult && !tryOnLoading && (
                  <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = tryOnResult;
                        link.download = 'tallfit-preview.png';
                        link.click();
                      }}
                      className="p-3 bg-white border border-border text-text hover:bg-accent hover:text-bg transition-all shadow-xl"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BRAND DIRECTORY */}
      <section id="brands" className="px-6 md:px-16 py-24 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-end gap-8 mb-16">
            <div className="max-w-2xl">
              <p className="text-[11px] tracking-[0.2em] uppercase text-accent mb-4 font-medium">CURATED FOR YOU</p>
              <h2 className="font-serif text-4xl md:text-6xl font-light leading-tight text-text">
                The Tall <em className="italic text-accent not-italic">Brand Directory</em>.
              </h2>
            </div>
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input type="text" placeholder="Search brands..." className="w-full pl-10 pr-4 py-2 bg-smoke border border-border text-xs focus:outline-none focus:border-accent" />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {brands.map((brand) => (
              <div key={brand.id} className="group border border-border p-8 hover:border-accent transition-all bg-bg/30">
                <div className="flex justify-between items-start mb-6">
                  <div className="w-12 h-12 bg-white border border-border flex items-center justify-center">
                    <Shirt className="w-6 h-6 text-accent" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-accent">{brand.priceRange}</span>
                    <a href={brand.url} target="_blank" rel="noreferrer" className="p-2 hover:bg-accent/10 rounded-full transition-colors">
                      <ExternalLink className="w-4 h-4 text-muted" />
                    </a>
                  </div>
                </div>
                <h3 className="font-serif text-2xl mb-3 group-hover:text-accent transition-colors">{brand.name}</h3>
                <p className="text-sm text-muted leading-relaxed mb-6">{brand.description}</p>
                <div className="flex items-center gap-2 mb-6">
                  <span className="text-[9px] tracking-widest uppercase font-bold text-accent">Max Inseam:</span>
                  <span className="text-[10px] font-serif">{brand.maxInseam}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {brand.categories.map(cat => (
                    <span key={cat} className="text-[9px] tracking-tighter uppercase px-2 py-1 bg-white border border-border text-muted">{cat}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* BRAND COMPARISON TABLE */}
          <div className="mt-24 overflow-x-auto">
            <div className="inline-block min-w-full align-middle">
              <div className="border border-border bg-white shadow-sm overflow-hidden">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-bg">
                    <tr>
                      <th className="px-6 py-4 text-left text-[10px] tracking-widest uppercase text-muted font-bold">Brand</th>
                      <th className="px-6 py-4 text-left text-[10px] tracking-widest uppercase text-muted font-bold">Max Inseam</th>
                      <th className="px-6 py-4 text-left text-[10px] tracking-widest uppercase text-muted font-bold">Price Range</th>
                      <th className="px-6 py-4 text-left text-[10px] tracking-widest uppercase text-muted font-bold">Specialty</th>
                      <th className="px-6 py-4 text-left text-[10px] tracking-widest uppercase text-muted font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {brands.map((brand) => (
                      <tr key={brand.id} className="hover:bg-bg/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap font-serif text-lg">{brand.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-accent">{brand.maxInseam}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">{brand.priceRange}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs text-muted">{brand.categories.join(', ')}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <a href={brand.url} target="_blank" rel="noreferrer" className="text-[9px] tracking-widest uppercase font-bold text-text hover:text-accent transition-colors">Visit Store</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* THE TALL TRUTH: FIT JOURNAL */}
      <section id="journal" className="px-6 md:px-16 py-24 bg-bg border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-end gap-8 mb-16">
            <div className="max-w-2xl">
              <p className="text-[11px] tracking-[0.3em] uppercase text-accent mb-4 font-bold">COMMUNITY KNOWLEDGE</p>
              <h2 className="font-serif text-4xl md:text-6xl font-light leading-tight text-text">
                The Tall <em className="italic text-accent not-italic">Truth</em> Journal.
              </h2>
              <p className="text-muted text-sm mt-4 uppercase tracking-widest">Real fit data from real tall frames.</p>
            </div>
            {user && (
              <button className="px-8 py-4 bg-text text-bg text-[10px] tracking-widest uppercase font-bold hover:bg-accent transition-all">
                Log a Fit Review
              </button>
            )}
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                user: "Marcus R.",
                height: "6'7\"",
                inseam: "38\"",
                brand: "American Tall",
                product: "Carman Tapered Jeans",
                rating: 5,
                tags: ["Sleeve Length", "True to Size"],
                review: "Finally, a pair of jeans where the 'Extra Long' actually means extra long. The taper is perfect for a slimmer build without being tight.",
                date: "2 days ago"
              },
              {
                user: "David K.",
                height: "6'9\"",
                inseam: "40\"",
                brand: "2Tall",
                product: "Essential Tall Tee",
                rating: 4,
                tags: ["Torso Length", "Shrinkage"],
                review: "Great initial length. Lost about half an inch after the first wash, but still longer than anything I can find at standard retailers.",
                date: "1 week ago"
              },
              {
                user: "Liam S.",
                height: "6'5\"",
                inseam: "36\"",
                brand: "ASOS Tall",
                product: "Slim Fit Chinos",
                rating: 3,
                tags: ["Waist Fit", "Inseam Accuracy"],
                review: "Inseam is spot on, but the waist runs a bit large. Definitely need a belt with these. Quality is decent for the price.",
                date: "3 days ago"
              }
            ].map((review, i) => (
              <div key={i} className="bg-white border border-border p-8 hover:border-accent transition-all group">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-serif text-lg">{review.user}</span>
                      <span className="text-[9px] bg-smoke px-2 py-0.5 border border-border text-muted font-bold uppercase">{review.height} / {review.inseam}</span>
                    </div>
                    <p className="text-[10px] text-muted uppercase tracking-tighter">{review.date}</p>
                  </div>
                  <div className="flex gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-3 h-3 ${i < review.rating ? 'text-accent fill-accent' : 'text-border'}`} />
                    ))}
                  </div>
                </div>
                
                <div className="mb-6">
                  <p className="text-[10px] tracking-widest uppercase text-accent font-bold mb-1">{review.brand}</p>
                  <h4 className="font-serif text-xl mb-4">{review.product}</h4>
                  <p className="text-sm text-muted leading-relaxed italic mb-6">"{review.review}"</p>
                  <a 
                    href={getAffiliateLink(review.brand, brands.find(b => b.name === review.brand)?.url || '#')}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-[9px] tracking-[0.2em] uppercase font-bold text-accent hover:text-text transition-colors"
                  >
                    Buy This Fit <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex flex-wrap gap-2 pt-6 border-t border-border">
                  {review.tags.map(tag => (
                    <span key={tag} className="text-[8px] tracking-widest uppercase px-2 py-1 bg-bg border border-border text-muted font-bold">{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THE HOLY GRAIL WALL */}
      <section className="px-6 md:px-16 py-24 bg-smoke border-t border-border overflow-hidden relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full opacity-[0.03] pointer-events-none select-none flex items-center justify-center font-serif text-[20rem] whitespace-nowrap">
          GRAIL GRAIL GRAIL
        </div>
        
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center mb-20">
            <p className="text-[11px] tracking-[0.5em] uppercase text-accent mb-4 font-bold">THE BEST OF THE BEST</p>
            <h2 className="font-serif text-5xl md:text-7xl font-light text-text mb-6">The Holy Grail Wall</h2>
            <p className="text-muted text-sm uppercase tracking-[0.2em] max-w-xl mx-auto">The single best items for tall frames, vetted by the community.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            {[
              {
                category: "Best Overall Denim",
                name: "American Tall Carman Tapered",
                brand: "American Tall",
                url: "https://americantall.com/collections/mens-tall-denim",
                reason: "Unmatched inseam options up to 40\" with a modern taper that doesn't look like 'dad jeans'.",
                score: "9.8/10",
                image: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&q=80&w=800"
              },
              {
                category: "Best Basic Tee",
                name: "2Tall Essential Extra Long",
                brand: "2Tall",
                url: "https://www.2tall.com/tops/t-shirts.html",
                reason: "The only tee that stays long after 20+ washes. Heavyweight cotton that drapes perfectly.",
                score: "9.5/10",
                image: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&q=80&w=800"
              }
            ].map((grail, i) => (
              <div key={i} className="flex flex-col md:flex-row bg-white border border-border overflow-hidden group hover:border-accent transition-all">
                <div className="w-full md:w-1/2 aspect-square overflow-hidden">
                  <img src={grail.image} alt={grail.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" referrerPolicy="no-referrer" />
                </div>
                <div className="w-full md:w-1/2 p-10 flex flex-col justify-center">
                  <div className="flex justify-between items-start mb-6">
                    <span className="text-[10px] tracking-widest uppercase text-accent font-bold">{grail.category}</span>
                    <span className="font-serif text-2xl text-text">{grail.score}</span>
                  </div>
                  <h3 className="font-serif text-3xl mb-6 leading-tight">{grail.name}</h3>
                  <p className="text-sm text-muted leading-relaxed mb-8">{grail.reason}</p>
                  <div className="flex gap-6 mt-4">
                    <a 
                      href={getAffiliateLink(grail.brand, grail.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="px-6 py-3 bg-text text-bg text-[10px] tracking-widest uppercase font-bold hover:bg-accent transition-all"
                    >
                      Shop Now
                    </a>
                    <button className="text-[10px] tracking-widest uppercase font-bold border-b-2 border-accent pb-1 hover:text-accent transition-colors">
                      Full Specs
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NEWSLETTER */}
      <section className="px-6 md:px-16 py-24 bg-text text-bg overflow-hidden relative">
        <div className="absolute -right-20 -top-20 w-96 h-96 bg-accent/20 rounded-full blur-[100px]" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <p className="text-[11px] tracking-[0.3em] uppercase text-accent mb-6 font-bold">Join the TallFit Club</p>
          <h2 className="font-serif text-4xl md:text-6xl font-light mb-8">Never miss a style drop.</h2>
          <p className="text-bg/60 text-lg mb-12 max-w-xl mx-auto leading-relaxed">
            Get curated style tips, tall brand alerts, and early access to new AI fitting features delivered to your inbox.
          </p>
          <form className="flex flex-col md:flex-row gap-4 max-w-md mx-auto" onSubmit={(e) => { e.preventDefault(); alert("Subscribed! Welcome to the club."); }}>
            <input 
              type="email" 
              placeholder="Your email address" 
              className="flex-1 bg-white/10 border border-white/20 px-6 py-4 text-sm focus:outline-none focus:border-accent transition-colors text-bg placeholder:text-bg/30"
              required
            />
            <button className="px-8 py-4 bg-accent text-text text-[11px] tracking-widest uppercase font-bold hover:bg-accent-dark transition-all">
              Subscribe
            </button>
          </form>
        </div>
      </section>

      {/* FOR BRANDS */}
      <section id="brands-b2b" className="px-6 md:px-16 py-24 bg-white border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-bg p-8 border border-border">
                  <h4 className="font-serif text-3xl text-accent mb-2">98%</h4>
                  <p className="text-[10px] tracking-widest uppercase text-muted font-bold">Accuracy</p>
                  <p className="text-xs text-muted mt-4">Our AI measurement estimation reduces returns for tall-specific apparel.</p>
                </div>
                <div className="bg-bg p-8 border border-border mt-8">
                  <h4 className="font-serif text-3xl text-accent mb-2">3.5x</h4>
                  <p className="text-[10px] tracking-widest uppercase text-muted font-bold">Conversion</p>
                  <p className="text-xs text-muted mt-4">Users who "Try-On" virtually are more likely to complete their purchase.</p>
                </div>
              </div>
              {/* ANALYTICS PREVIEW */}
              <div className="mt-8 p-6 bg-text text-bg border border-white/10 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-[8px] tracking-widest uppercase font-bold text-accent">Partner Dashboard Preview</span>
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-accent rounded-full" />
                    <div className="w-1 h-1 bg-white/20 rounded-full" />
                    <div className="w-1 h-1 bg-white/20 rounded-full" />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} whileInView={{ width: '85%' }} className="h-full bg-accent" />
                  </div>
                  <div className="flex justify-between text-[8px] tracking-tighter uppercase text-bg/40">
                    <span>Fit Accuracy</span>
                    <span className="text-bg">85%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} whileInView={{ width: '62%' }} className="h-full bg-white/40" />
                  </div>
                  <div className="flex justify-between text-[8px] tracking-tighter uppercase text-bg/40">
                    <span>Return Reduction</span>
                    <span className="text-bg">62%</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <p className="text-[11px] tracking-[0.2em] uppercase text-accent mb-4 font-medium">B2B Solutions</p>
              <h2 className="font-serif text-4xl md:text-5xl font-light text-text mb-8">Empower your brand with <em className="italic text-accent">TallFit AI</em>.</h2>
              <p className="text-muted text-lg leading-relaxed mb-8">
                Integrate our proprietary measurement and virtual try-on technology directly into your e-commerce store. Reduce sizing-related returns and build loyalty with the tall community.
              </p>
              <button className="px-10 py-4 bg-text text-bg text-[10px] tracking-widest uppercase font-bold hover:bg-accent-dark transition-all flex items-center gap-3">
                PARTNER WITH US
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="px-6 md:px-16 py-12 border-t border-border flex flex-col md:flex-row justify-between items-center gap-6 bg-white">
        <div className="font-serif text-xl text-muted">TallFit</div>
        <div className="text-[10px] text-muted tracking-widest uppercase">Built for bodies that don't fit the standard.</div>
      </footer>

      {/* RECOMMENDATIONS MODAL */}
      <AnimatePresence>
        {isChatOpen && recommendations && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChatOpen(false)} className="absolute inset-0 bg-text/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative bg-bg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-border">
              <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-white">
                <div>
                  <h2 className="text-2xl font-bold text-text">Your Tailored Style Guide</h2>
                  <p className="text-[10px] tracking-widest uppercase text-muted mt-1">Based on {formData.height} frame</p>
                </div>
                <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-bg rounded-full transition-colors"><X className="w-6 h-6 text-muted" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-12">
                <div className="grid md:grid-cols-3 gap-8">
                  {recommendations.outfits.map((outfit, i) => (
                    <div key={i} className="bg-white border border-border p-6 flex flex-col h-full group hover:border-accent transition-colors">
                      <div className="w-10 h-10 bg-accent/10 flex items-center justify-center mb-6"><span className="font-bold text-accent">0{i+1}</span></div>
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="text-xl font-bold group-hover:text-accent transition-colors">{outfit.title}</h3>
                        <button 
                          onClick={() => toggleFavorite(outfit)}
                          className="p-2 hover:bg-bg rounded-full transition-colors"
                        >
                          <Heart className={`w-4 h-4 ${favorites.some(f => f.title === outfit.title) ? 'fill-accent text-accent' : 'text-muted'}`} />
                        </button>
                      </div>
                      <p className="text-sm text-muted leading-relaxed mb-6 flex-1">{outfit.description}</p>
                      <div className="space-y-4">
                        <div>
                          <p className="text-[9px] tracking-widest uppercase text-accent mb-2 font-bold">Recommended Brands</p>
                          <div className="flex flex-wrap gap-2">{outfit.brands.map((brand, bi) => (<span key={bi} className="text-[10px] bg-bg px-2 py-1 border border-border">{brand}</span>))}</div>
                        </div>
                        <div>
                          <p className="text-[9px] tracking-widest uppercase text-accent mb-2 font-bold">Fit Tips</p>
                          <ul className="space-y-1">{outfit.fitTips.map((tip, ti) => (<li key={ti} className="text-[10px] text-muted flex items-start gap-2"><CheckCircle2 className="w-3 h-3 text-accent shrink-0 mt-0.5" />{tip}</li>))}</ul>
                        </div>
                        {outfit.shopUrl && (
                          <a 
                            href={outfit.shopUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="mt-4 w-full py-3 bg-accent/10 text-accent text-[10px] tracking-widest uppercase font-bold hover:bg-accent hover:text-bg transition-all flex items-center justify-center gap-2"
                          >
                            Shop this Look
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-accent/5 border border-accent/20 p-8">
                  <div className="flex items-center gap-3 mb-6"><Info className="w-5 h-5 text-accent" /><h3 className="font-serif text-xl">Stylist's Final Word</h3></div>
                  <div className="markdown-body text-sm text-muted leading-relaxed max-w-3xl"><Markdown>{recommendations.generalAdvice}</Markdown></div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FAVORITES MODAL */}
      <AnimatePresence>
        {isFavoritesOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFavoritesOpen(false)} className="absolute inset-0 bg-text/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }} className="relative bg-bg w-full max-w-md h-full ml-auto overflow-hidden flex flex-col shadow-2xl border-l border-border">
              <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-white">
                <h2 className="font-serif text-2xl text-text">Saved Looks</h2>
                <button onClick={() => setIsFavoritesOpen(false)} className="p-2 hover:bg-bg rounded-full transition-colors"><X className="w-6 h-6 text-muted" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {favorites.length === 0 ? (
                  <div className="text-center py-12">
                    <Heart className="w-12 h-12 text-border mx-auto mb-4" />
                    <p className="text-sm text-muted">No saved looks yet.</p>
                  </div>
                ) : (
                  favorites.map((fav) => (
                    <div key={fav.id} className="bg-white border border-border p-6 relative group">
                      <button 
                        onClick={() => toggleFavorite(fav)}
                        className="absolute top-4 right-4 p-1 text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <h3 className="font-serif text-lg mb-2">{fav.title}</h3>
                      <p className="text-xs text-muted mb-4 line-clamp-2">{fav.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] tracking-widest uppercase text-accent font-bold">{fav.brands[0]}</span>
                        {fav.shopUrl && (
                          <a href={fav.shopUrl} target="_blank" rel="noopener noreferrer" className="text-[8px] tracking-widest uppercase font-bold text-text hover:text-accent flex items-center gap-1">
                            Shop <ExternalLink className="w-2 h-2" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CHAT BOT */}
      <ChatBot />
    </div>
  );
}

function StyleQuiz({ formData, setFormData, onSubmit, loading }: { 
  formData: any; 
  setFormData: any; 
  onSubmit: any; 
  loading: boolean;
}) {
  const [step, setStep] = useState(1);
  const [estimating, setEstimating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const totalSteps = 3;

  const nextStep = () => setStep(s => Math.min(s + 1, totalSteps));
  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleAIEstimate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert("File too large. Max size is 5MB.");
      return;
    }

    setEstimating(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        const mimeType = (reader.result as string).split(';')[0].split(':')[1];
        const estimates = await estimateMeasurementsFromImage(base64, mimeType);
        setFormData((prev: any) => ({ ...prev, ...estimates }));
      } catch (err) {
        console.error(err);
        alert("Failed to estimate measurements. Please try again.");
      } finally {
        setEstimating(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="bg-white border border-border p-10 md:p-16 shadow-sm max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-16">
        <div className="flex gap-3">
          {[1, 2, 3].map((s) => (
            <div 
              key={s} 
              className={`h-0.5 w-16 transition-all duration-500 ${s <= step ? 'bg-accent' : 'bg-smoke'}`} 
            />
          ))}
        </div>
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted font-bold">Step {step} of {totalSteps}</span>
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div 
            key="step1"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-10"
          >
            <div className="flex flex-col md:flex-row justify-between items-start gap-6">
              <h3 className="font-serif text-4xl leading-tight max-w-sm">Let's start with your <em className="italic text-accent">frame</em>.</h3>
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={estimating}
                className="flex items-center gap-3 px-6 py-3 bg-smoke text-text text-[10px] tracking-widest uppercase font-bold hover:bg-accent hover:text-bg transition-all"
              >
                {estimating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                AI ESTIMATE
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleAIEstimate} 
                accept="image/*" 
                className="hidden" 
              />
            </div>
            <div className="grid md:grid-cols-2 gap-10">
              <div className="space-y-3">
                <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-muted">Height</label>
                <input name="height" value={formData.height} onChange={handleInputChange} placeholder="e.g. 6'5&quot;" className="w-full bg-smoke border-b border-border px-4 py-4 text-lg font-serif focus:border-accent outline-none transition-colors" />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-muted">Inseam</label>
                <input name="inseam" value={formData.inseam} onChange={handleInputChange} placeholder="e.g. 36&quot;" className="w-full bg-smoke border-b border-border px-4 py-4 text-lg font-serif focus:border-accent outline-none transition-colors" />
              </div>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div 
            key="step2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-10"
          >
            <h3 className="font-serif text-4xl leading-tight">How are you <em className="italic text-accent">built</em>?</h3>
            <div className="grid md:grid-cols-2 gap-10">
              <div className="space-y-3">
                <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-muted">Build</label>
                <input name="build" value={formData.build} onChange={handleInputChange} placeholder="e.g. Slim, Athletic" className="w-full bg-smoke border-b border-border px-4 py-4 text-lg font-serif focus:border-accent outline-none transition-colors" />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-muted">Shoulder Width</label>
                <input name="shoulderWidth" value={formData.shoulderWidth} onChange={handleInputChange} placeholder="e.g. 20&quot;" className="w-full bg-smoke border-b border-border px-4 py-4 text-lg font-serif focus:border-accent outline-none transition-colors" />
              </div>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div 
            key="step3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-10"
          >
            <h3 className="font-serif text-4xl leading-tight">What's your <em className="italic text-accent">vibe</em>?</h3>
            <div className="grid md:grid-cols-2 gap-10">
              <div className="space-y-3">
                <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-muted">Style Preference</label>
                <select name="stylePreference" value={formData.stylePreference} onChange={handleInputChange} className="w-full bg-smoke border-b border-border px-4 py-4 text-lg font-serif focus:border-accent outline-none transition-colors appearance-none">
                  <option>Casual</option>
                  <option>Formal</option>
                  <option>Streetwear</option>
                  <option>Business Casual</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-muted">Occasion</label>
                <select name="occasion" value={formData.occasion} onChange={handleInputChange} className="w-full bg-smoke border-b border-border px-4 py-4 text-lg font-serif focus:border-accent outline-none transition-colors appearance-none">
                  <option>Daily Wear</option>
                  <option>Wedding</option>
                  <option>Work</option>
                  <option>Date Night</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-between mt-20 pt-10 border-t border-smoke">
        {step > 1 ? (
          <button 
            onClick={prevStep}
            className="px-8 py-4 text-[10px] tracking-[0.2em] uppercase font-bold text-muted hover:text-text transition-colors"
          >
            Previous
          </button>
        ) : <div />}

        {step < totalSteps ? (
          <button 
            onClick={nextStep}
            className="px-12 py-4 bg-text text-bg text-[10px] tracking-[0.2em] uppercase font-bold hover:bg-accent transition-all flex items-center gap-3"
          >
            NEXT <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button 
            onClick={onSubmit}
            disabled={loading}
            className="px-12 py-4 bg-accent text-bg text-[10px] tracking-[0.2em] uppercase font-bold hover:bg-accent-dark transition-all flex items-center gap-3"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate Guide
          </button>
        )}
      </div>
    </div>
  );
}

function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([
    { role: 'model', text: "Hello! I'm your TallFit stylist. How can I help you find the perfect fit today?" }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [lastCall, setLastCall] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const now = Date.now();
    if (now - lastCall < RATE_LIMIT_MS) {
      setMessages(prev => [...prev, { role: 'model', text: "Slow down! Please wait a moment between messages." }]);
      return;
    }
    setLastCall(now);

    const userMessage = DOMPurify.sanitize(input.trim());
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsTyping(true);

    try {
      const text = await chatWithStylist(userMessage, messages.slice(-10));
      setMessages(prev => [...prev, { role: 'model', text: text || "I'm sorry, I couldn't process that." }]);
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: "I'm having trouble connecting. Please try again." }]);
    } finally {
      setIsTyping(false);
      setTimeout(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, 100);
    }
  };

  return (
    <div className="fixed bottom-8 right-8 z-[100]">
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="absolute bottom-20 right-0 w-[350px] md:w-[400px] h-[500px] bg-bg border border-border shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-white border-b border-border px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-accent/10 flex items-center justify-center rounded-full"><Shirt className="w-4 h-4 text-accent" /></div>
                <div><h3 className="font-serif text-lg leading-none">TallFit Stylist</h3><span className="text-[9px] tracking-widest uppercase text-accent font-bold">Online</span></div>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-muted hover:text-text transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-white/30">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-4 py-3 text-sm ${msg.role === 'user' ? 'bg-text text-bg' : 'bg-white border border-border text-text'}`}>
                    <div className="markdown-body text-xs leading-relaxed"><Markdown>{msg.text}</Markdown></div>
                  </div>
                </div>
              ))}
              {isTyping && <div className="flex justify-start"><div className="bg-white border border-border px-4 py-3 text-xs text-muted italic">Stylist is thinking...</div></div>}
            </div>
            <div className="p-4 bg-white border-t border-border">
              <div className="relative flex items-center">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Ask about your fit..." className="w-full bg-bg border border-border px-4 py-3 pr-12 text-sm focus:outline-none focus:border-accent transition-colors" />
                <button onClick={handleSend} disabled={!input.trim() || isTyping} className="absolute right-2 p-2 text-accent hover:text-accent-dark disabled:opacity-30 transition-colors"><ArrowRight className="w-5 h-5" /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setIsOpen(!isOpen)} className="w-16 h-16 bg-accent text-bg flex items-center justify-center shadow-2xl rounded-full hover:bg-accent-dark transition-all relative group">
        <Shirt className="w-7 h-7" />
        <div className="absolute top-0 right-0 w-4 h-4 bg-red-500 border-2 border-bg rounded-full shadow-sm" />
      </motion.button>
    </div>
  );
}
