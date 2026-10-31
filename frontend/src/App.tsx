import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpenText,
  Bookmark,
  Bot,
  Camera,
  CheckCircle2,
  ChevronRight,
  Compass,
  Eye,
  Heart,
  Library,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Send,
  ShoppingBag,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  UploadCloud,
  X,
} from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  apiRequest,
  ApiError,
  clearAccessToken,
  isValidEmail,
  normalizeEmail,
  saveAccessToken,
  type AuthResponse,
  type AuthUser,
  type ScanResponse,
  type VerificationResponse,
} from './api'
import { books, genreChips, type Book } from './data/mockData'

const sidebarItems = [
  { label: 'Home', path: '/dashboard', icon: Sparkles },
  { label: 'Scan Bookshelf', path: '/scanner', icon: Camera },
  { label: 'Discover Books', path: '/results', icon: Compass },
  { label: 'Recommendations', path: '/recommendations', icon: Sparkles },
  { label: 'AI Book Assistant', path: '/assistant', icon: Bot },
  { label: 'My Library', path: '/library', icon: Library },
  { label: 'Favourites', path: '/favourites', icon: Heart },
  { label: 'Scan History', path: '/history', icon: BookOpenText },
  { label: 'Reading Preferences', path: '/onboarding', icon: Bookmark },
  { label: 'Shelf Personality', path: '/personality', icon: Sparkles },
  { label: 'Reading Twin', path: '/reading-twin', icon: Users },
  { label: 'Shelf Comparison', path: '/comparison', icon: BarChart3 },
  { label: 'Book Store', path: '/store', icon: ShoppingBag },
  { label: 'Shopping Cart', path: '/cart', icon: ShoppingBag },
  { label: 'Admin Dashboard', path: '/admin', icon: ShieldCheck },
  { label: 'Settings', path: '/settings', icon: Settings },
]

const categoryStyles: Record<string, string> = {
  'BUY IT': 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/20',
  'SAVE IT': 'bg-amber-500/10 text-amber-700 border border-amber-500/20',
  'SKIP IT': 'bg-slate-500/10 text-slate-700 border border-slate-500/20',
}

type ApiBook = {
  id: string
  title: string
  author: string
  genre: string
  description: string
  cover: string
  publisher: string
  publication_year: number | null
  match_score: number
  recommendation_reason: string
  ai_explanation: string
  isbn: string | null
  average_rating: number | null
  ratings_count: number | null
  editions: Array<Record<string, unknown>>
  retailer_name: string | null
  retailer_url: string | null
  price_amount: number | null
  price_currency: string | null
  price_updated_at: string | null
  metadata_source: string
}

function mapApiBook(book: ApiBook): Book {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    genre: book.genre,
    description: book.description,
    cover: book.cover,
    publisher: book.publisher,
    publicationYear: book.publication_year ?? 0,
    matchScore: book.match_score,
    compatibility: book.match_score,
    recommendation: book.recommendation_reason || book.description,
    aiExplanation: book.ai_explanation,
    isbn: book.isbn,
    averageRating: book.average_rating,
    ratingsCount: book.ratings_count,
    editions: book.editions,
    retailerName: book.retailer_name,
    retailerUrl: book.retailer_url,
    priceAmount: book.price_amount,
    priceCurrency: book.price_currency,
    priceUpdatedAt: book.price_updated_at,
    metadataSource: book.metadata_source,
  }
}

const AdminRoleContext = createContext(false)

function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  )
}

function AppRouter() {
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem('shelfscan_access_token')))
  const [authReady, setAuthReady] = useState(!localStorage.getItem('shelfscan_access_token'))
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [splashFinished, setSplashFinished] = useState(false)
  const [splashFading, setSplashFading] = useState(false)
  const [library, setLibrary] = useState<{ id: string; shelf: string }[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!loggedIn) return

    let active = true
    void Promise.all([
      apiRequest<Array<{ id: string; status: string }>>('/api/library'),
      apiRequest<Array<{ id: string }>>('/api/favourites'),
      apiRequest<{ favourite_genres?: string[] }>('/api/preferences'),
    ])
      .then(([entries, favouriteEntries, preferences]) => {
        if (!active) return
        setLibrary(entries.map((entry) => ({
          id: entry.id,
          shelf: entry.status === 'currently_reading' ? 'Currently Reading'
            : entry.status === 'completed' ? 'Completed'
              : entry.status === 'favourite' ? 'Favourites'
                : 'Want to Read',
        })))
        setFavorites(favouriteEntries.map((entry) => entry.id))
        setSelectedGenres(preferences.favourite_genres ?? [])
      })
      .catch((error: unknown) => {
        if (active) setNotice(error instanceof Error ? error.message : 'Could not load your library.')
      })

    return () => {
      active = false
    }
  }, [loggedIn])

  useEffect(() => {
    const token = localStorage.getItem('shelfscan_access_token')
    if (token) {
      void apiRequest<AuthUser>('/api/auth/me')
        .then((user) => {
          setCurrentUser(user)
          setAuthReady(true)
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) {
            clearAccessToken()
            setLoggedIn(false)
            setCurrentUser(null)
            setLibrary([])
            setFavorites([])
            setSelectedGenres([])
          } else if (error instanceof Error) {
            setNotice(error.message)
          }
          setAuthReady(true)
        })
    }

    const fadeTimer = window.setTimeout(() => setSplashFading(true), 29_700)
    const finishTimer = window.setTimeout(() => {
      const authenticated = Boolean(localStorage.getItem('shelfscan_access_token'))
      setLoggedIn(authenticated)
      setSplashFinished(true)
      navigateRef.current(authenticated ? '/dashboard' : '/login', { replace: true })
    }, 30_000)

    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(finishTimer)
    }
  }, [])

  const handleLogin = (token: string, user?: AuthUser) => {
    saveAccessToken(token)
    setLoggedIn(true)
    if (user) setCurrentUser(user)
  }

  const handleLogout = async () => {
    try {
      if (localStorage.getItem('shelfscan_access_token')) {
        await apiRequest('/api/auth/logout', { method: 'POST' })
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not contact the server while signing out.')
    } finally {
      clearAccessToken()
      setCurrentUser(null)
      setLoggedIn(false)
      setLibrary([])
      setFavorites([])
      setSelectedGenres([])
      navigate('/login', { replace: true })
    }
  }

  const toggleFavorite = (bookId: string) => {
    const removing = favorites.includes(bookId)
    void apiRequest(`/api/favourites/${encodeURIComponent(bookId)}`, {
      method: removing ? 'DELETE' : 'POST',
    }).then(() => {
      setFavorites((current) => removing ? current.filter((id) => id !== bookId) : [...current, bookId])
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not update favourites.')
    })
  }

  const addToLibrary = (bookId: string) => {
    void apiRequest('/api/library/save', {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId, status: 'want_to_read' }),
    }).then(() => {
      setLibrary((current) => current.some((item) => item.id === bookId)
        ? current.map((item) => item.id === bookId ? { ...item, shelf: 'Want to Read' } : item)
        : [...current, { id: bookId, shelf: 'Want to Read' }])
      setNotice('Book saved to your library.')
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not save this book.')
    })
  }

  const addToCart = (bookId: string, quantity = 1) => {
    return apiRequest('/api/cart', {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId, quantity }),
    }).then(() => {
      setNotice('Book added to your shopping cart.')
      return true
    })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not add this book to your cart.')
        return false
      })
  }

  const updateLibraryStatus = (bookId: string, status: string) => {
    void apiRequest('/api/library/save', {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId, status }),
    }).then(() => {
      const shelf = status === 'currently_reading' ? 'Currently Reading'
        : status === 'completed' ? 'Completed'
          : status === 'favourite' ? 'Favourites'
            : 'Want to Read'
      setLibrary((current) => current.map((item) => item.id === bookId ? { ...item, shelf } : item))
      setNotice('Reading status updated.')
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not update this book.')
    })
  }

  const handleScanComplete = (result: ScanResponse) => setScanResult(result)

  if (!splashFinished) return <SplashScreen isFading={splashFading} />

  return (
    <>
      <AdminRoleContext.Provider value={currentUser?.role === 'admin'}>
      <Routes>
        <Route path="/" element={<Navigate to={loggedIn ? '/dashboard' : '/login'} replace />} />
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage onLogin={handleLogin} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/onboarding" element={<ProtectedRoute isAuthenticated={loggedIn}><OnboardingPage selectedGenres={selectedGenres} setSelectedGenres={setSelectedGenres} /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute isAuthenticated={loggedIn}><DashboardPage onLogout={handleLogout} favoriteIds={favorites} libraryCount={library.length} toggleFavorite={toggleFavorite} addToLibrary={addToLibrary} userName={currentUser?.full_name} /></ProtectedRoute>} />
        <Route path="/scanner" element={<ProtectedRoute isAuthenticated={loggedIn}><ScannerPage onLogout={handleLogout} onScanComplete={handleScanComplete} /></ProtectedRoute>} />
        <Route path="/results" element={<ProtectedRoute isAuthenticated={loggedIn}><ResultsPage onLogout={handleLogout} favoriteIds={favorites} toggleFavorite={toggleFavorite} addToLibrary={addToLibrary} scanResult={scanResult} /></ProtectedRoute>} />
        <Route path="/recommendations" element={<ProtectedRoute isAuthenticated={loggedIn}><RecommendationsPage onLogout={handleLogout} favoriteIds={favorites} toggleFavorite={toggleFavorite} addToLibrary={addToLibrary} addToCart={addToCart} /></ProtectedRoute>} />
        <Route path="/library" element={<ProtectedRoute isAuthenticated={loggedIn}><LibraryPage onLogout={handleLogout} library={library} favoriteIds={favorites} toggleFavorite={toggleFavorite} addToLibrary={addToLibrary} updateStatus={updateLibraryStatus} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute isAuthenticated={loggedIn}><SettingsPage onLogout={handleLogout} user={currentUser} selectedGenres={selectedGenres} setSelectedGenres={setSelectedGenres} /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute isAuthenticated={loggedIn}><HistoryPage onLogout={handleLogout} /></ProtectedRoute>} />
        <Route path="/favourites" element={<ProtectedRoute isAuthenticated={loggedIn}><FavouritesPage onLogout={handleLogout} favoriteIds={favorites} toggleFavorite={toggleFavorite} addToCart={addToCart} /></ProtectedRoute>} />
        <Route path="/personality" element={<ProtectedRoute isAuthenticated={loggedIn}><ShelfPersonalityPage onLogout={handleLogout} selectedGenres={selectedGenres} /></ProtectedRoute>} />
        <Route path="/reading-twin" element={<ProtectedRoute isAuthenticated={loggedIn}><ReadingTwinPage onLogout={handleLogout} selectedGenres={selectedGenres} /></ProtectedRoute>} />
        <Route path="/comparison" element={<ProtectedRoute isAuthenticated={loggedIn}><ShelfComparisonPage onLogout={handleLogout} selectedGenres={selectedGenres} /></ProtectedRoute>} />
        <Route path="/assistant" element={<ProtectedRoute isAuthenticated={loggedIn}><BookAssistantPage onLogout={handleLogout} /></ProtectedRoute>} />
        <Route path="/store" element={<ProtectedRoute isAuthenticated={loggedIn}><BookStorePage onLogout={handleLogout} addToLibrary={addToLibrary} addToCart={addToCart} favoriteIds={favorites} toggleFavorite={toggleFavorite} /></ProtectedRoute>} />
        <Route path="/cart" element={<ProtectedRoute isAuthenticated={loggedIn}><ShoppingCartPage onLogout={handleLogout} /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute isAuthenticated={loggedIn}>{!authReady ? <p className="p-6 text-sm text-[#597162]">Loading account…</p> : currentUser?.role === 'admin' ? <AdminDashboardPage onLogout={handleLogout} /> : <Navigate to="/dashboard" replace />}</ProtectedRoute>} />
        <Route path="/book/:id" element={<ProtectedRoute isAuthenticated={loggedIn}><BookDetailsPage onLogout={handleLogout} favoriteIds={favorites} toggleFavorite={toggleFavorite} addToLibrary={addToLibrary} addToCart={addToCart} /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={loggedIn ? '/dashboard' : '/login'} replace />} />
      </Routes>
      </AdminRoleContext.Provider>
      {notice && <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-white/50 bg-[#28634C] px-5 py-3 text-sm text-white shadow-xl">{notice}<button onClick={() => setNotice('')} className="ml-3 font-semibold">×</button></div>}
    </>
  )
}

function ProtectedRoute({ isAuthenticated, children }: { isAuthenticated: boolean; children: ReactNode }) {
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function SplashScreen({ isFading }: { isFading: boolean }) {
  return (
    <AnimatePresence>
      <motion.main
        key="shelfscan-splash"
        initial={{ opacity: 0 }}
        animate={{ opacity: isFading ? 0 : 1 }}
        transition={{ duration: isFading ? 0.3 : 0.65, ease: 'easeInOut' }}
        className="app-atmosphere relative flex items-center justify-center overflow-hidden px-5"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_48%,rgba(244,242,225,0.38),transparent_58%)]" />
        <div className="relative z-10 flex w-full max-w-xl flex-col items-center px-8 py-10 text-center sm:px-16 sm:py-14">
          <motion.img
            src="/shelf-scan-logo-transparent.png"
            alt="SHELF SCAN — Discover Your Next Favourite Book."
            className="h-44 w-44 object-contain sm:h-56 sm:w-56"
            initial={{ scale: 0.92, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
          <p className="mt-4 text-base font-medium tracking-wide text-[#28634C] sm:text-lg">
            Discover Your Next Favourite Book.
          </p>
          <div className="relative mt-10 flex h-16 w-64 items-end justify-center gap-1 overflow-hidden rounded-2xl border border-white/55 bg-white/25 px-5 pb-2">
            {[22, 38, 30, 45, 28, 40, 24].map((height, index) => (
              <motion.div
                key={`${height}-${index}`}
                className="w-6 rounded-t-md border border-white/40"
                style={{ height, background: index % 2 ? '#397B5C' : '#B8D8C5' }}
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: index * 0.12 }}
              />
            ))}
            <motion.div
              className="absolute left-0 right-0 h-0.5 bg-[#7bb794]/90 shadow-[0_0_16px_4px_rgba(123,183,148,0.34)]"
              animate={{ top: ['15%', '85%', '15%'] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </div>
      </motion.main>
    </AnimatePresence>
  )
}

function GlassButton({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-full bg-gradient-to-r from-[#28634C] to-[#397B5C] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_36px_rgba(40,99,76,0.25)] transition hover:scale-[1.02] hover:shadow-[0_20px_40px_rgba(40,99,76,0.3)] ${className}`}>
      {children}
    </button>
  )
}

function TopNav({ title, subtitle, onLogout, onMenuToggle }: { title: string; subtitle?: string; onLogout?: () => void; onMenuToggle?: () => void }) {
  return (
    <header className="flex items-center justify-between gap-4 rounded-[22px] border border-white/55 bg-white/45 px-4 py-3 shadow-[0_12px_30px_rgba(32,53,43,0.07)] backdrop-blur-xl sm:px-5">
      <div className="flex items-center gap-4">
        <button type="button" aria-label="Toggle navigation" onClick={onMenuToggle} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-white/30 lg:hidden">
          <Menu className="h-5 w-5 text-[#20352B]" />
        </button>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#718477]">
            {subtitle ?? 'Shelf Scan'}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[#20352B]">{title}</h2>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full border border-white/40 bg-white/40 px-3 py-2 sm:flex">
          <Search className="h-4 w-4 text-[#5c6f63]" />
          <input
            className="w-40 bg-transparent text-sm text-[#20352B] placeholder:text-[#718477] outline-none"
            placeholder="Search books"
          />
        </div>
        <button className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-white/40 text-[#20352B]">
          <Bell className="h-4 w-4" />
        </button>
        <button onClick={onLogout} className="inline-flex items-center gap-2 rounded-full border border-[#DDECE2] bg-[#F1F6F1] px-3 py-2 text-sm font-medium text-[#20352B]">
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </header>
  )
}

function AppShell({ children, pageTitle, subtitle, onLogout }: { children: ReactNode; pageTitle: string; subtitle?: string; onLogout: () => void }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const isAdmin = useContext(AdminRoleContext)

  return (
    <div className="app-atmosphere px-3 py-4 text-[#20352B] sm:px-5 sm:py-5 lg:px-7">
      <div className="mx-auto max-w-[1440px]">
        <div className="grid gap-4 lg:grid-cols-[228px_minmax(0,1fr)] xl:gap-5">
          {mobileNavOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-40 bg-[#173e31]/20 backdrop-blur-[2px] lg:hidden" />}
          <aside className={`${mobileNavOpen ? 'fixed left-3 top-3 z-50 max-h-[calc(100vh-24px)] w-[min(84vw,270px)] overflow-y-auto' : 'hidden'} rounded-[24px] border border-white/15 bg-gradient-to-b from-[#173e31] to-[#245b43] p-4 text-white shadow-[0_18px_48px_rgba(32,53,43,0.17)] lg:sticky lg:top-5 lg:block lg:max-h-[calc(100vh-40px)] lg:overflow-y-auto`}>
            <div className="mb-5 flex items-center justify-between gap-2.5 border-b border-white/15 pb-4">
              <div className="flex items-center gap-2.5">
              <img src="/shelf-scan-logo-transparent.png" alt="SHELF SCAN logo" className="h-11 w-11 rounded-xl object-contain" />
              <div>
                <p className="text-[9px] uppercase tracking-[0.2em] text-white/60">Discover · Scan · Read</p>
                <h1 className="text-[15px] font-semibold tracking-wide">SHELF SCAN</h1>
              </div>
              </div>
              <button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="rounded-full p-2 text-white/80 hover:bg-white/10 lg:hidden"><X className="h-4 w-4" /></button>
            </div>

            <nav aria-label="Main navigation" className="space-y-1">
              {sidebarItems.filter(({ label }) => label !== 'Admin Dashboard' || isAdmin).map(({ label, path, icon: Icon }) => (
                <NavLink
                  key={label}
                  end={label === 'Home'}
                  to={path}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12px] font-medium transition ${
                      isActive
                        ? 'bg-white/18 text-white shadow-[0_8px_20px_rgba(12,40,28,0.18)]'
                        : 'text-white/75 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.08] p-3">
              <div className="mb-2 flex items-center gap-2 text-white">
                <ShieldCheck className="h-3.5 w-3.5 text-[#c8dfc7]" />
                <span className="text-xs font-semibold">Shelf Personality</span>
              </div>
              <p className="text-[11px] leading-5 text-white/70">
                Your shelf brings together thoughtful mysteries and character-led stories.
              </p>
            </div>
          </aside>

          <main className="min-w-0 space-y-4 sm:space-y-5">
            <TopNav title={pageTitle} subtitle={subtitle} onLogout={onLogout} onMenuToggle={() => setMobileNavOpen((open) => !open)} />
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}

function LoginPage({ onLogin }: { onLogin: (token: string, user: AuthUser) => void }) {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      setError('Please enter a valid email address.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      const response = await apiRequest<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, password, remember_me: rememberMe }),
      })
      onLogin(response.token, response.user)
      navigate('/dashboard', { replace: true })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Sign in failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="app-atmosphere flex items-center justify-center px-4 py-8 sm:px-6">
      <div className="grid w-full max-w-[980px] overflow-hidden rounded-[28px] border border-white/65 bg-white/30 shadow-[0_28px_76px_rgba(43,76,63,0.13)] backdrop-blur-2xl lg:min-h-[590px] lg:grid-cols-[0.94fr_1.06fr]">
        <section className="relative flex min-h-[310px] flex-col overflow-hidden border-b border-white/50 bg-gradient-to-br from-[#e7f2e9]/90 via-[#edf4e9]/85 to-[#d8eadc]/90 p-6 sm:min-h-[360px] sm:p-9 lg:min-h-0 lg:border-b-0 lg:border-r lg:p-10">
          <div className="pointer-events-none absolute -left-16 top-24 h-52 w-52 rounded-full bg-[#b8d8c5]/35 blur-3xl" />
          <div className="pointer-events-none absolute -right-10 bottom-0 h-48 w-48 rounded-full bg-[#f3eedb]/60 blur-3xl" />
          <div className="relative z-10 flex items-center justify-center gap-3 lg:justify-start">
            <img src="/shelf-scan-logo-transparent.png" alt="SHELF SCAN logo" className="h-[68px] w-[68px] object-contain sm:h-[76px] sm:w-[76px]" />
            <div className="text-left">
              <p className="text-[9px] uppercase tracking-[0.2em] text-[#718477]">Discover</p>
              <h1 className="text-xl font-semibold text-[#163d30] sm:text-2xl">SHELF SCAN</h1>
              <p className="text-[10px] text-[#405d4c] sm:text-xs">Discover Your Next Favourite Book.</p>
            </div>
          </div>

          <div className="relative z-10 mt-5 text-center lg:mt-10 lg:text-left">
            <p className="text-sm font-semibold text-[#20352B] sm:text-base">Find Stories Worth Discovering.</p>
            <p className="mx-auto mt-1 max-w-xs text-[10px] leading-4 text-[#597162] sm:text-xs lg:mx-0">
              Scan any bookshelf and discover books that match your reading personality.
            </p>
          </div>

          <div aria-hidden="true" className="relative z-10 mt-auto flex h-[112px] items-end justify-center overflow-hidden rounded-[20px] border border-white/65 bg-white/25 px-5 pb-3 pt-2 shadow-[0_14px_32px_rgba(49,83,60,0.08)] sm:h-[145px] lg:mt-6 lg:h-[190px]">
            <div className="absolute bottom-3 left-[9%] right-[9%] h-2 rounded-full bg-gradient-to-r from-[#9d6d3e] via-[#d2a35d] to-[#99663b] shadow-[0_5px_8px_rgba(78,56,33,0.2)]" />
            {books.slice(0, 5).map((book, index) => (
              <div key={book.id} className="relative mx-1 flex w-[15%] max-w-[70px] items-end">
                <img
                  src={book.cover}
                  alt=""
                  className="w-full rounded-t-[5px] border border-white/70 object-cover shadow-[0_8px_14px_rgba(32,53,43,0.18)]"
                  style={{ height: `${68 + (index % 3) * 13}px` }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center p-4 sm:p-7 lg:p-9">
          <div className="w-full max-w-[390px] rounded-[24px] border border-white/75 bg-[#fffef9]/55 p-5 shadow-[0_18px_45px_rgba(48,69,52,0.09)] backdrop-blur-2xl sm:p-7">
            <div className="mb-5 text-center">
              <h2 className="text-lg font-semibold text-[#20352B] sm:text-xl">Welcome Back!</h2>
              <p className="mt-1 text-[10px] text-[#718477] sm:text-xs">Sign in to your shelf journey</p>
            </div>

            <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
              <div>
                <label htmlFor="login-email" className="sr-only">Email address</label>
                <div className="flex items-center gap-2 rounded-xl border border-[#e1e8dc] bg-white/55 px-3 py-2.5 transition focus-within:border-[#78a888]">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-[#73917b]" />
                  <input id="login-email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required placeholder="Email address" className="w-full bg-transparent text-xs text-[#20352B] outline-none placeholder:text-[#89968b]" type="text" />
                </div>
              </div>
              <div>
                <label htmlFor="login-password" className="sr-only">Password</label>
                <div className="flex items-center gap-2 rounded-xl border border-[#e1e8dc] bg-white/55 px-3 py-2.5 transition focus-within:border-[#78a888]">
                  <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-[#73917b]" />
                  <input id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required placeholder="Password" className="w-full bg-transparent text-xs text-[#20352B] outline-none placeholder:text-[#89968b]" type={showPassword ? 'text' : 'password'} />
                  <button type="button" onClick={() => setShowPassword((state) => !state)} className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#397B5C]">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-[10px] text-[#597162]">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="h-3 w-3 rounded border-[#cbd9ce] text-[#28634C] focus:ring-[#397B5C]" />
                  Remember me
                </label>
                <button type="button" onClick={() => navigate('/forgot-password')} className="font-medium text-[#28634C]">
                  Forgot password?
                </button>
              </div>

              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
              <button type="submit" disabled={isSubmitting} className="w-full rounded-full bg-gradient-to-r from-[#28634C] to-[#388057] px-4 py-2.5 text-xs font-semibold text-white shadow-[0_9px_20px_rgba(40,99,76,0.2)] transition hover:brightness-105 disabled:opacity-70">
                {isSubmitting ? 'Signing in…' : 'Sign In'}
              </button>

              <div className="flex items-center gap-2 py-0.5 text-[9px] text-[#89968b]">
                <span className="h-px flex-1 bg-[#dfe8df]" />
                OR
                <span className="h-px flex-1 bg-[#dfe8df]" />
              </div>
              <button type="button" onClick={() => setError('Google sign-in is not configured for this application.')} className="flex w-full items-center justify-center gap-2 rounded-full border border-[#dfe5e0] bg-white/55 px-4 py-2.5 text-[10px] font-semibold text-[#20352B] transition hover:bg-white/80">
                <Search className="h-3.5 w-3.5" />
                Continue with Google
              </button>

              <p className="pt-1 text-center text-[10px] text-[#597162]">
                Don’t have an account?{' '}
                <button type="button" onClick={() => navigate('/register')} className="font-semibold text-[#28634C]">
                  Create account
                </button>
              </p>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}

function RegisterPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const strength = password.length >= 10 ? 'Strong' : password.length >= 7 ? 'Good' : 'Weak'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      setError('Please enter a valid email address.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      const response = await apiRequest<VerificationResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: normalizedEmail,
          password,
          favourite_genres: selectedGenres,
        }),
      })
      navigate(`/verify-email?email=${encodeURIComponent(normalizedEmail)}`, {
        state: { developmentCode: response.development_code },
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Account creation failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="app-atmosphere flex items-center justify-center p-4">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/55 bg-white/25 shadow-[0_30px_80px_rgba(43,76,63,0.12)] backdrop-blur-xl lg:grid-cols-[0.78fr_1.22fr]">
        <div className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#eef7ef] via-[#e4f1e7] to-[#cfe4d4] p-8 lg:flex">
          <div className="flex items-center gap-3"><img src="/shelf-scan-logo-transparent.png" alt="SHELF SCAN logo" className="h-14 w-14 object-contain" /><div><p className="text-[9px] uppercase tracking-[0.2em] text-[#718477]">Discover · Scan · Read</p><p className="text-lg font-semibold text-[#20352B]">SHELF SCAN</p></div></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#397B5C]">A world of stories</p>
            <h3 className="mt-2 text-3xl font-semibold leading-tight text-[#20352B]">Find stories worth discovering.</h3>
            <p className="mt-3 text-sm leading-6 text-[#597162]">Build your reading profile and let your bookshelf inspire your next favourite read.</p>
            <div className="mt-8 flex h-36 items-end justify-center gap-2 rounded-[24px] border border-white/65 bg-white/35 px-5 pb-4 shadow-sm">
              {[books[1], books[2], books[0], books[4], books[3]].map((book, index) => <img key={book.id} src={book.cover} alt="" className="w-12 rounded-t-md border border-white/70 object-cover shadow-md" style={{ height: `${74 + index % 3 * 16}px` }} />)}
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-8">
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#718477]">Join us</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#20352B]">Create your account</h2>
        </div>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#20352B]">Full name</label>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required minLength={2} className="w-full rounded-2xl border border-[#dfe5e0] bg-white/60 px-4 py-3 text-[#20352B] outline-none focus:border-[#397B5C]" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#20352B]">Email</label>
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required className="w-full rounded-2xl border border-[#dfe5e0] bg-white/60 px-4 py-3 text-[#20352B] outline-none focus:border-[#397B5C]" type="text" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#20352B]">Password</label>
            <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} className="w-full rounded-2xl border border-[#dfe5e0] bg-white/60 px-4 py-3 text-[#20352B] outline-none focus:border-[#397B5C]" type="password" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#20352B]">Confirm password</label>
            <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required className="w-full rounded-2xl border border-[#dfe5e0] bg-white/60 px-4 py-3 text-[#20352B] outline-none focus:border-[#397B5C]" type="password" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium text-[#20352B]">Favourite genres</label>
            <div className="flex flex-wrap gap-2">
              {genreChips.map((genre) => (
                <button key={genre} type="button" onClick={() => setSelectedGenres((current) => current.includes(genre) ? current.filter((value) => value !== genre) : [...current, genre])} className={`rounded-full border px-3 py-2 text-sm ${selectedGenres.includes(genre) ? 'border-[#28634C] bg-[#28634C] text-white' : 'border-[#dfe5e0] bg-white/60 text-[#20352B]'}`}>
                  {genre}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between rounded-2xl border border-[#dfe5e0] bg-white/60 p-3">
              <span className="text-sm font-medium text-[#20352B]">Password strength</span>
              <span className={`text-sm font-semibold ${strength === 'Strong' ? 'text-emerald-700' : strength === 'Good' ? 'text-amber-700' : 'text-rose-700'}`}>{strength}</span>
            </div>
          </div>

          {error && <p role="alert" className="md:col-span-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
          <div className="md:col-span-2 flex flex-col gap-3 sm:flex-row">
            <GlassButton className="flex-1">{isSubmitting ? 'Creating account…' : 'Create account'}</GlassButton>
            <button type="button" onClick={() => navigate('/login')} className="rounded-full border border-[#dfe5e0] bg-white/60 px-5 py-3 text-sm font-semibold text-[#20352B]">
              Back to login
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

function VerifyEmailPage({ onLogin }: { onLogin: (token: string, user: AuthUser) => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const email = normalizeEmail(searchParams.get('email') ?? '')
  const [code, setCode] = useState('')
  const [developmentCode, setDevelopmentCode] = useState<string | undefined>(
    (location.state as { developmentCode?: string } | null)?.developmentCode,
  )
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit verification code from your email.')
      return
    }
    setError('')
    setIsSubmitting(true)
    try {
      const response = await apiRequest<AuthResponse>('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      })
      onLogin(response.token, response.user)
      navigate('/onboarding', { replace: true })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Email verification failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resendCode = async () => {
    setError('')
    setMessage('')
    try {
      const response = await apiRequest<VerificationResponse>('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setDevelopmentCode(response.development_code)
      setMessage(response.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not resend the code.')
    }
  }

  return (
    <div className="app-atmosphere flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-[32px] border border-white/50 bg-white/35 p-7 shadow-[0_30px_80px_rgba(43,76,63,0.12)] backdrop-blur-xl sm:p-10">
        <img src="/shelf-scan-logo-transparent.png" alt="SHELF SCAN logo" className="mx-auto mb-5 h-24 w-24 object-contain" />
        <p className="text-center text-xs uppercase tracking-[0.2em] text-[#718477]">Email verification</p>
        <h2 className="mt-2 text-center text-3xl font-semibold text-[#20352B]">Check your inbox</h2>
        <p className="mt-3 text-center text-sm text-[#597162]">
          Enter the 6-digit code sent to <strong>{email || 'your email address'}</strong>. The code expires in 10 minutes.
        </p>
        {developmentCode && <p className="mt-4 rounded-2xl bg-[#e8f4eb] px-4 py-3 text-center text-sm text-[#28634C]">Development code: <strong>{developmentCode}</strong></p>}
        <form className="mt-6 space-y-4" onSubmit={(event) => void handleVerify(event)}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[#20352B]">Verification code</span>
            <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required className="w-full rounded-2xl border border-[#dfe5e0] bg-white/70 px-4 py-3 text-center text-xl tracking-[0.45em] text-[#20352B] outline-none focus:border-[#397B5C]" />
          </label>
          {error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
          {message && <p role="status" className="rounded-2xl bg-[#e8f4eb] px-4 py-3 text-sm text-[#28634C]">{message}</p>}
          <GlassButton className="w-full">{isSubmitting ? 'Verifying…' : 'Verify email'}</GlassButton>
        </form>
        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-[#597162]">
          <span>Didn’t receive a code?</span>
          <button type="button" onClick={() => void resendCode()} className="font-semibold text-[#28634C]">Resend code</button>
        </div>
      </div>
    </div>
  )
}

function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [requested, setRequested] = useState(false)
  const [developmentCode, setDevelopmentCode] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const requestReset = async () => {
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      setError('Please enter a valid email address.')
      return
    }
    setEmail(normalizedEmail)
    setError('')
    setIsSubmitting(true)
    try {
      const response = await apiRequest<VerificationResponse>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail }),
      })
      setRequested(true)
      setDevelopmentCode(response.development_code ?? '')
      setMessage(response.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not request a reset code.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.')
      return
    }
    setError('')
    setIsSubmitting(true)
    try {
      const response = await apiRequest<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: normalizeEmail(email), code, new_password: newPassword }),
      })
      setMessage(response.message)
      navigate('/login', { replace: true, state: { message: response.message } })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not reset the password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="app-atmosphere flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-[32px] border border-white/50 bg-white/35 p-7 shadow-[0_30px_80px_rgba(43,76,63,0.12)] backdrop-blur-xl sm:p-10">
        <h2 className="text-3xl font-semibold text-[#20352B]">Reset your password</h2>
        <p className="mt-3 text-sm text-[#597162]">We’ll send a time-limited reset code to your email address.</p>
        {!requested ? (
          <div className="mt-6 space-y-4">
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" placeholder="Email address" type="text" className="w-full rounded-2xl border border-[#dfe5e0] bg-white/70 px-4 py-3 text-[#20352B] outline-none focus:border-[#397B5C]" />
            {error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
            <GlassButton className="w-full" onClick={() => void requestReset()}>{isSubmitting ? 'Sending…' : 'Send reset code'}</GlassButton>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={(event) => void resetPassword(event)}>
            <p role="status" className="rounded-2xl bg-[#e8f4eb] px-4 py-3 text-sm text-[#28634C]">{message}</p>
            {developmentCode && <p className="text-sm text-[#28634C]">Development code: <strong>{developmentCode}</strong></p>}
            <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" required className="w-full rounded-2xl border border-[#dfe5e0] bg-white/70 px-4 py-3 text-[#20352B] outline-none focus:border-[#397B5C]" />
            <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="New password (at least 8 characters)" minLength={8} required type="password" className="w-full rounded-2xl border border-[#dfe5e0] bg-white/70 px-4 py-3 text-[#20352B] outline-none focus:border-[#397B5C]" />
            {error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
            <GlassButton className="w-full">{isSubmitting ? 'Resetting…' : 'Reset password'}</GlassButton>
          </form>
        )}
        <button type="button" onClick={() => navigate('/login')} className="mt-5 w-full text-center text-sm font-semibold text-[#28634C]">Back to sign in</button>
      </div>
    </div>
  )
}

function OnboardingPage({ selectedGenres, setSelectedGenres }: { selectedGenres: string[]; setSelectedGenres: Dispatch<SetStateAction<string[]>> }) {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([])
  const [selectedHabits, setSelectedHabits] = useState<string[]>(['Evening reader', 'Weekend deep dives'])
  const authors = ['Agatha Christie', 'J.R.R. Tolkien', 'Jane Austen', 'Neil Gaiman', 'Emily Henry']
  const habits = ['Evening reader', 'Weekend deep dives', 'Book club picks', 'Quick mystery bursts']

  useEffect(() => {
    let active = true
    void apiRequest<{
      favourite_genres?: string[]
      favourite_authors?: string[]
      reading_habits?: string[]
    }>('/api/preferences')
      .then((preferences) => {
        if (!active) return
        if (preferences.favourite_genres) setSelectedGenres(preferences.favourite_genres)
        if (preferences.favourite_authors) setSelectedAuthors(preferences.favourite_authors)
        if (preferences.reading_habits) setSelectedHabits(preferences.reading_habits)
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load your reading preferences.')
      })
    return () => {
      active = false
    }
  }, [setSelectedGenres])

  const toggleGenre = (genre: string) => {
    setSelectedGenres((current) =>
      current.includes(genre) ? current.filter((item) => item !== genre) : [...current, genre],
    )
  }

  const savePreferences = async () => {
    setError('')
    setIsSaving(true)
    try {
      await apiRequest('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          favourite_genres: selectedGenres,
          favourite_authors: selectedAuthors,
          reading_categories: selectedHabits,
          reading_habits: selectedHabits,
          books_enjoyed_previously: [],
        }),
      })
      await apiRequest('/api/recommendations/generate', {
        method: 'POST',
        body: JSON.stringify({ books: [] }),
      })
      navigate('/dashboard')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save your preferences.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/60 bg-white/25 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl lg:grid-cols-[0.78fr_1.22fr]">
      <div className="relative hidden min-h-[570px] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#eef7ef] via-[#e4f1e7] to-[#cfe4d4] p-7 lg:flex">
        <div className="flex items-center gap-3"><img src="/shelf-scan-logo-transparent.png" alt="SHELF SCAN logo" className="h-14 w-14 object-contain" /><div><p className="text-[9px] uppercase tracking-[0.2em] text-[#718477]">Discover · Scan · Read</p><p className="text-lg font-semibold text-[#20352B]">SHELF SCAN</p></div></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#397B5C]">A shelf that feels like you</p>
          <h3 className="mt-2 text-3xl font-semibold leading-tight text-[#20352B]">Every reader has a story.</h3>
          <p className="mt-3 text-sm leading-6 text-[#597162]">Choose the genres and authors you love to make your recommendations feel personal.</p>
          <div className="mt-8 flex h-36 items-end justify-center gap-2 rounded-[24px] border border-white/65 bg-white/35 px-5 pb-4 shadow-sm">
            {[books[1], books[2], books[0], books[4], books[3]].map((book, index) => <img key={book.id} src={book.cover} alt="" className="w-12 rounded-t-md border border-white/70 object-cover shadow-md" style={{ height: `${74 + index % 3 * 16}px` }} />)}
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#718477]">Reading preferences</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#20352B]">Tell us about your reading taste</h2>
          <p className="mt-1 text-xs text-[#597162]">Your choices help us find books you'll love.</p>
        </div>
        <button type="button" onClick={() => navigate('/dashboard')} className="hidden rounded-full border border-[#dfe5e0] bg-white/60 px-3 py-2 text-xs font-medium text-[#20352B] md:inline-flex">
          Skip for now
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3 rounded-[20px] border border-white/65 bg-white/40 p-4">
          <h3 className="text-sm font-semibold text-[#20352B]">Favourite genres</h3>
          <div className="flex flex-wrap gap-2">
            {genreChips.map((genre) => {
              const active = selectedGenres.includes(genre)
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => toggleGenre(genre)}
                  className={`rounded-full border px-2.5 py-1.5 text-[10px] font-medium transition ${
                    active
                      ? 'border-[#28634C] bg-[#28634C] text-white shadow-[0_12px_24px_rgba(40,99,76,0.25)]'
                      : 'border-[#dfe5e0] bg-white/60 text-[#20352B]'
                  }`}
                >
                  {genre}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-3 rounded-[20px] border border-white/65 bg-white/40 p-4">
          <h3 className="text-sm font-semibold text-[#20352B]">Reading habits</h3>
          <div className="space-y-1.5 text-[11px] text-[#597162]">
            {habits.map((habit) => {
              const active = selectedHabits.includes(habit)
              return <button type="button" key={habit} onClick={() => setSelectedHabits((current) => active ? current.filter((value) => value !== habit) : [...current, habit])} className="flex w-full items-center justify-between rounded-xl border border-[#dfe5e0] bg-white/55 px-3 py-2 text-left"><span>{habit}</span><CheckCircle2 className={`h-4 w-4 ${active ? 'text-[#28634C]' : 'text-[#c2d0c6]'}`} /></button>
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-[20px] border border-white/65 bg-white/40 p-4">
        <h3 className="text-sm font-semibold text-[#20352B]">Favourite authors</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {authors.map((author) => {
            const active = selectedAuthors.includes(author)
            return <button key={author} type="button" onClick={() => setSelectedAuthors((current) => active ? current.filter((value) => value !== author) : [...current, author])} className={`rounded-full border px-2.5 py-1.5 text-[10px] font-medium ${active ? 'border-[#28634C] bg-[#28634C] text-white' : 'border-[#dfe5e0] bg-white/60 text-[#20352B]'}`}>{author}</button>
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="text-[11px] text-[#597162]">
          {selectedGenres.length} genres · {selectedAuthors.length} authors
        </div>
        <GlassButton className="px-4 py-2.5 text-xs" onClick={() => void savePreferences()}>{isSaving ? 'Saving…' : 'Continue'} <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></GlassButton>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      </div>
    </div>
  )
}

function DashboardPage({ onLogout, favoriteIds, libraryCount, toggleFavorite, addToLibrary, userName }: { onLogout: () => void; favoriteIds: string[]; libraryCount: number; toggleFavorite: (bookId: string) => void; addToLibrary: (bookId: string) => void; userName?: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activity, setActivity] = useState<{ scannedBooks: number | null; recommendations: number | null }>({ scannedBooks: null, recommendations: null })
  const [recentScans, setRecentScans] = useState<Array<{ id: string; name: string; created_at: string; books: Array<{ title: string }> }>>([])
  const [recommendations, setRecommendations] = useState<Array<{ book: Book; score: number; reason: string }>>([])
  const [favoriteGenres, setFavoriteGenres] = useState<string[]>([])
  const [activityError, setActivityError] = useState('')
  const firstName = (userName ?? 'reader').split(' ')[0]
  const recommended = recommendations.filter(({ book }) => `${book.title} ${book.author} ${book.genre}`.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    let active = true
    void Promise.all([
      apiRequest<Array<{ id: string; name: string; created_at: string; books: Array<{ title: string }> }>>('/api/scanner/history'),
      apiRequest<Array<{ book_id: string; match_score: number; reason: string }>>('/api/recommendations'),
      apiRequest<{ favourite_genres?: string[] }>('/api/preferences'),
    ]).then(async ([scans, recommendationEntries, preferences]) => {
      const hydrated = await Promise.all(recommendationEntries.map(async (entry) => ({
        book: mapApiBook(await apiRequest<ApiBook>(`/api/books/${encodeURIComponent(entry.book_id)}`)),
        score: entry.match_score,
        reason: entry.reason,
      })))
      if (!active) return
      setRecentScans(scans)
      setRecommendations(hydrated)
      setFavoriteGenres(preferences.favourite_genres ?? [])
      setActivity({
        scannedBooks: scans.reduce((total, scan) => total + scan.books.length, 0),
        recommendations: recommendationEntries.length,
      })
    }).catch((requestError: unknown) => {
      if (active) setActivityError(requestError instanceof Error ? requestError.message : 'Could not load your reading activity.')
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <AppShell pageTitle="Dashboard" subtitle="Home" onLogout={onLogout}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div><h3 className="text-lg font-semibold text-[#20352B]">Welcome back, {firstName}!</h3><p className="text-xs text-[#597162]">Ready to discover your next favourite story?</p></div>
          <div className="flex items-center gap-2 rounded-full border border-white/60 bg-white/50 px-3 py-2 text-xs text-[#718477]"><Search className="h-3.5 w-3.5" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter recommendations…" className="w-36 bg-transparent text-[#20352B] outline-none sm:w-52" /></div>
        </div>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative grid min-h-[200px] overflow-hidden rounded-[22px] border border-white/65 bg-gradient-to-r from-[#e4f1e7] via-[#f2f8f2] to-[#d5e9db] p-5 shadow-[0_12px_30px_rgba(32,53,43,0.07)] sm:grid-cols-[1fr_0.8fr] sm:items-center sm:px-7">
          <div className="relative z-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#397B5C]">A little inspiration for today</p>
            <h4 className="mt-2 max-w-md text-xl font-semibold leading-tight text-[#20352B] sm:text-2xl">Your next great read is waiting on the shelf.</h4>
            <p className="mt-2 max-w-sm text-xs leading-5 text-[#597162]">Scan your bookshelf or explore personalized matches picked for your reading taste.</p>
            <div className="mt-4 flex flex-wrap gap-2"><GlassButton className="px-4 py-2.5 text-xs" onClick={() => navigate('/scanner')}>Scan My Bookshelf</GlassButton><button type="button" onClick={() => navigate('/recommendations')} className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/65 px-4 py-2.5 text-xs font-semibold text-[#28634C]">Discover books<ChevronRight className="h-3.5 w-3.5" /></button></div>
          </div>
          <div aria-hidden="true" className="relative hidden h-36 items-end justify-center gap-2 sm:flex">
            <div className="absolute bottom-1 h-3 w-56 rounded-full bg-[#a9793e]/80 shadow-md" />
            {books.slice(0, 4).map((book, index) => <img key={book.id} src={book.cover} alt="" className="relative z-10 h-24 w-16 rounded-t-md border border-white/60 object-cover shadow-md" style={{ height: `${96 + (index % 2) * 20}px` }} />)}
            <div className="absolute bottom-4 right-5 h-24 w-1 rounded-full bg-[#b48148]" />
          </div>
        </motion.section>

        {activityError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{activityError}</p>}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[{ label: 'Books scanned', value: activity.scannedBooks ?? '—', icon: Camera }, { label: 'Your library', value: libraryCount, icon: Library }, { label: 'Recommendations', value: activity.recommendations ?? '—', icon: Sparkles }, { label: 'Favourites', value: favoriteIds.length, icon: Heart }].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center gap-2 rounded-[16px] border border-white/70 bg-white/45 px-3 py-3 shadow-sm"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#e6f2e8] text-[#28634C]"><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-[9px] text-[#718477]">{label}</p><p className="text-sm font-semibold text-[#20352B]">{value}</p></div></div>
          ))}
        </section>

        <SectionCard className="p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between"><div><h4 className="text-sm font-semibold text-[#20352B]">Recommended for you</h4><p className="text-[10px] text-[#718477]">Hand-picked for your shelf personality</p></div><button type="button" onClick={() => navigate('/recommendations')} className="text-[10px] font-semibold text-[#28634C]">View all <ArrowRight className="ml-0.5 inline h-3 w-3" /></button></div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {recommended.slice(0, 4).map(({ book, score }) => {
              const active = favoriteIds.includes(book.id)
              return <article key={book.id} className="flex gap-2 rounded-[15px] border border-white/75 bg-white/45 p-2"><button type="button" onClick={() => navigate(`/book/${book.id}`)} className="shrink-0"><img src={book.cover} alt={book.title} className="h-24 w-16 rounded-lg object-cover" /></button><div className="flex min-w-0 flex-1 flex-col"><span className="text-[8px] uppercase tracking-[0.12em] text-[#718477]">{book.genre}</span><h5 className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-[#20352B]">{book.title}</h5><p className="mt-0.5 truncate text-[9px] text-[#597162]">{book.author}</p><div className="mt-auto flex items-center justify-between pt-2"><span className="text-[9px] font-semibold text-[#28634C]">{score}% match</span><button type="button" onClick={() => active ? navigate('/favourites') : toggleFavorite(book.id)} aria-label={`${active ? 'Open' : 'Add'} ${book.title} favourite`} className="text-[#28634C]"><Heart className={`h-3.5 w-3.5 ${active ? 'fill-current' : ''}`} /></button></div><button type="button" onClick={() => addToLibrary(book.id)} className="mt-1 rounded-full bg-[#28634C] px-2 py-1 text-[9px] font-semibold text-white">Save to library</button></div></article>
            })}
          </div>
          {recommended.length === 0 && <div className="py-4 text-center text-xs text-[#597162]"><p>{query ? 'No recommendations match your search.' : 'No recommendations are available yet.'}</p><button type="button" onClick={() => navigate('/recommendations')} className="mt-2 font-semibold text-[#28634C]">Explore recommendations</button></div>}
        </SectionCard>

        <section className="grid gap-3 md:grid-cols-2">
          <SectionCard className="p-4">
            <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-semibold text-[#20352B]">Recent shelf scans</h4><button type="button" onClick={() => navigate('/history')} className="text-[10px] font-semibold text-[#28634C]">View all</button></div>
            <div className="space-y-2">{recentScans.slice(0, 2).map((scan) => <button key={scan.id} type="button" onClick={() => navigate('/history')} className="flex w-full items-center justify-between rounded-xl border border-white/70 bg-white/50 px-3 py-2 text-left"><span className="text-xs font-medium text-[#20352B]">{scan.name}<span className="ml-2 text-[10px] font-normal text-[#718477]">{new Date(scan.created_at).toLocaleDateString()}</span></span><span className="text-[10px] text-[#28634C]">{scan.books.length} books <ChevronRight className="ml-1 inline h-3 w-3" /></span></button>)}{recentScans.length === 0 && <p className="py-2 text-xs text-[#718477]">No shelf scans yet.</p>}</div>
          </SectionCard>
          <SectionCard className="p-4">
            <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-semibold text-[#20352B]">Your favourite genres</h4><button type="button" onClick={() => navigate('/onboarding')} className="text-[10px] font-semibold text-[#28634C]">Edit</button></div>
            <div className="flex flex-wrap gap-2">{favoriteGenres.map((genre) => <span key={genre} className="rounded-full border border-[#d5e6da] bg-[#edf6ef] px-3 py-1.5 text-[10px] font-medium text-[#28634C]">{genre}</span>)}{favoriteGenres.length === 0 && <p className="text-xs text-[#718477]">Choose genres in your reading preferences to personalize this section.</p>}</div>
          </SectionCard>
        </section>
      </div>
    </AppShell>
  )
}

function ScannerPage({ onLogout, onScanComplete }: { onLogout: () => void; onScanComplete: (result: ScanResponse) => void }) {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  const selectImage = (file?: File) => {
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setSelectedFile(null)
        setImagePreview(null)
        setError('Image must be 10 MB or smaller.')
        return
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setSelectedFile(null)
        setImagePreview(null)
        setError('Upload a JPEG, PNG, or WebP bookshelf image.')
        return
      }
      setError('')
      setSelectedFile(file)
      setImagePreview(URL.createObjectURL(file))
    }
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => selectImage(event.target.files?.[0])

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    selectImage(event.dataTransfer.files[0])
  }

  const analyzeShelf = async () => {
    if (!selectedFile) {
      setError('Choose a bookshelf image before starting the scan.')
      return
    }

    setError('')
    setIsScanning(true)
    const formData = new FormData()
    formData.append('file', selectedFile)
    try {
      const response = await apiRequest<ScanResponse>(
        `/api/scanner/analyze?name=${encodeURIComponent(selectedFile.name)}`,
        { method: 'POST', body: formData },
      )
      onScanComplete(response)
      navigate('/results')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Bookshelf analysis failed.')
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <AppShell pageTitle="Scan Bookshelf" subtitle="AI Scanner" onLogout={onLogout}>
      <div className="rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border border-white/40 bg-white/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#718477]">Upload</p>
                <h3 className="mt-2 text-2xl font-semibold text-[#20352B]">Bookshelf scanner</h3>
              </div>
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-full border border-[#dfe5e0] bg-white/60 px-3 py-2 text-sm font-medium text-[#20352B]">
                Mobile camera
              </button>
            </div>

            <label onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className="group flex h-72 cursor-pointer flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-[#cfe1d5] bg-gradient-to-br from-[#f8fbf8] to-[#edf6f0] text-center transition hover:border-[#28634C]">
              {imagePreview ? (
                <img src={imagePreview} alt="Uploaded bookshelf preview" className="h-full w-full rounded-[24px] object-cover" />
              ) : (
                <>
                  <UploadCloud className="mb-3 h-10 w-10 text-[#28634C]" />
                  <span className="text-lg font-semibold text-[#20352B]">Drag and drop image here</span>
                  <span className="mt-2 text-sm text-[#597162]">PNG, JPG, or HEIC up to 10 MB</span>
                </>
              )}
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={onFileChange} />
            </label>

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => void analyzeShelf()} disabled={isScanning} className="rounded-full bg-gradient-to-r from-[#28634C] to-[#397B5C] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(40,99,76,0.25)] disabled:cursor-wait disabled:opacity-70">
                {isScanning ? 'Scanning…' : 'Scan Bookshelf'}
              </button>
              {imagePreview && (
                <button type="button" onClick={() => { URL.revokeObjectURL(imagePreview); setImagePreview(null); setSelectedFile(null); setError('') }} className="rounded-full border border-[#dfe5e0] bg-white/60 px-5 py-3 text-sm font-semibold text-[#20352B]">
                  Remove image
                </button>
              )}
            </div>
            {error && <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
          </div>

          <div className="space-y-5 rounded-[28px] border border-white/40 bg-white/40 p-5">
            <div className="rounded-[24px] border border-[#dfe5e0] bg-[#f8faf8] p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[#718477]">AI processing</p>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#e7efe8]">
                <motion.div initial={{ width: 0 }} animate={{ width: isScanning ? '100%' : '62%' }} transition={{ duration: 2.4, ease: 'easeInOut' }} className="h-full rounded-full bg-gradient-to-r from-[#28634C] via-[#3d7e61] to-[#A6D0B4]" />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.12em] text-[#597162]">
                <span>Identifying titles</span>
                <span>{isScanning ? 'Scanning' : 'Ready'}</span>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/40 bg-[#f1f7f2] p-4">
              <p className="text-sm font-semibold text-[#20352B]">AI workflow</p>
              <ul className="mt-3 space-y-3 text-sm text-[#597162]">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#28634C]" /> Image secure upload</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#28634C]" /> OCR + book detection</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#28634C]" /> Google Books metadata match</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#28634C]" /> Personalised recommendations</li>
              </ul>
            </div>

            <div aria-hidden="true" className="flex items-center justify-center rounded-[24px] bg-gradient-to-br from-[#eef7ef] to-[#dcecdf] py-3">
              <div className="relative h-28 w-48 rounded-t-[14px] border-x-[5px] border-t-[5px] border-[#9b7649] bg-white/40 shadow-[0_8px_18px_rgba(54,85,63,0.12)]">
                <div className="absolute inset-x-0 top-[56%] h-2 rounded-sm bg-[#a77b48] shadow-sm" />
                <div className="absolute inset-x-0 bottom-0 h-2 rounded-sm bg-[#a77b48] shadow-sm" />
                {['#397b5c', '#d2a24a', '#8e4b38', '#264f3d', '#dfc99a', '#638a68', '#9c573a', '#275c45', '#d7aa55'].map((color, index) => (
                  <span key={`${color}-${index}`} className="absolute bottom-2 w-3 rounded-t-sm border-x border-t border-white/30 shadow-sm" style={{ left: `${7 + index * 19}px`, height: `${34 + (index * 17) % 28}px`, background: color }} />
                ))}
                {['#ba8c4c', '#325c45', '#e3d3a7', '#87513c', '#43764f', '#bd8b46', '#294a39'].map((color, index) => (
                  <span key={`upper-${index}`} className="absolute top-2 w-3 rounded-t-sm border-x border-t border-white/30 shadow-sm" style={{ left: `${15 + index * 23}px`, height: `${24 + (index * 13) % 24}px`, background: color }} />
                ))}
              </div>
            </div>

            {selectedFile && <p className="rounded-2xl border border-[#dfe5e0] bg-white/60 px-4 py-3 text-sm text-[#597162]">Ready to securely analyze: {selectedFile.name}</p>}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function ResultsPage({ onLogout, favoriteIds, toggleFavorite, addToLibrary, scanResult }: { onLogout: () => void; favoriteIds: string[]; toggleFavorite: (bookId: string) => void; addToLibrary: (bookId: string) => void; scanResult: ScanResponse | null }) {
  const navigate = useNavigate()
  const [recommendations, setRecommendations] = useState<Array<{ book: Book; score: number; category: string; reason: string }>>([])
  const [recommendationError, setRecommendationError] = useState('')

  useEffect(() => {
    let active = true
    void apiRequest<Array<{ book_id: string; category: string; match_score: number; reason: string }>>('/api/recommendations')
      .then(async (entries) => {
        const hydrated = await Promise.all(entries.map(async (entry) => ({
          book: mapApiBook(await apiRequest<ApiBook>(`/api/books/${encodeURIComponent(entry.book_id)}`)),
          score: entry.match_score,
          category: entry.category,
          reason: entry.reason,
        })))
        if (active) setRecommendations(hydrated)
      })
      .catch((requestError: unknown) => {
        if (active) setRecommendationError(requestError instanceof Error ? requestError.message : 'Could not load recommendations.')
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <AppShell pageTitle="Scan Results" subtitle="AI Results" onLogout={onLogout}>
      <div className="space-y-6">
        <section className="rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#718477]">Recognised books</p>
              <h3 className="mt-2 text-2xl font-semibold text-[#20352B]">Shelf scan results</h3>
            </div>
            <button onClick={() => navigate('/scanner')} className="rounded-full border border-[#dfe5e0] bg-white/60 px-4 py-2 text-sm font-medium text-[#20352B]">
              Rescan shelf
            </button>
          </div>

          {!scanResult && <div className="mb-6 rounded-[20px] border border-dashed border-[#cfe1d5] bg-white/45 p-5 text-center"><p className="text-sm text-[#597162]">No scan results are open. Start a bookshelf scan to see your recognized titles here.</p><button type="button" onClick={() => navigate('/scanner')} className="mt-3 rounded-full bg-[#28634C] px-4 py-2 text-xs font-semibold text-white">Scan a bookshelf</button></div>}
          {scanResult && (
            <div className="mb-6 rounded-[28px] border border-white/40 bg-white/40 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[#718477]">Latest scan · {scanResult.title}</p>
              <h4 className="mb-4 mt-2 text-xl font-semibold text-[#20352B]">{scanResult.recognized_books.length} books identified</h4>
              {scanResult.recognized_books.length === 0 ? (
                <p className="rounded-2xl bg-white/50 p-4 text-sm text-[#597162]">No readable book titles were found. Try a brighter, closer image with the spines facing forward.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {scanResult.recognized_books.map((item, index) => (
                    <div key={`${item.title}-${index}`} className="flex items-center gap-4 rounded-2xl border border-white/50 bg-white/60 p-3">
                      {item.metadata?.cover ? <img src={item.metadata.cover} alt="" className="h-20 w-14 rounded-lg object-cover" /> : <div aria-hidden="true" className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg bg-[#edf6ef] text-[#397B5C]"><BookOpenText className="h-6 w-6" /></div>}
                      <div className="min-w-0">
                        <p className="font-semibold text-[#20352B]">{item.title}</p>
                        <p className="text-sm text-[#597162]">{item.author || 'Author not confidently identified'}</p>
                        <p className={`mt-1 text-xs ${item.uncertain ? 'text-amber-700' : 'text-[#28634C]'}`}>
                          {item.uncertain ? 'Please review this identification' : `${Math.round(item.confidence * 100)}% recognition confidence`}
                        </p>
                        {item.book_id && <button onClick={() => addToLibrary(item.book_id!)} className="mt-1 text-xs font-semibold text-[#28634C]">Save to library</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mb-3 flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.16em] text-[#718477]">Your Next Recommended Read</p><p className="mt-1 text-[11px] text-[#597162]">Personalized matches from your saved reading profile.</p></div><button type="button" onClick={() => navigate('/recommendations')} className="text-xs font-semibold text-[#28634C]">View all</button></div>
          {recommendationError && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{recommendationError}</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recommendations.map(({ book, score, category, reason }) => {
              return (
                <article key={book.id} className="rounded-[20px] border border-white/60 bg-white/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${categoryStyles[category] ?? categoryStyles['SAVE IT']}`}>
                      {category}
                    </span>
                    <span className="text-[10px] font-semibold text-[#597162]">Match {score}%</span>
                  </div>
                  <img src={book.cover} alt={book.title} className="h-36 w-full rounded-[15px] object-cover" />
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-[9px] uppercase tracking-[0.12em] text-[#718477]">{book.genre}</p><h4 className="mt-0.5 truncate text-xs font-semibold text-[#20352B]">{book.title}</h4><p className="truncate text-[10px] text-[#597162]">{book.author}</p></div>
                    <button aria-label={`${favoriteIds.includes(book.id) ? 'Remove' : 'Add'} ${book.title} ${favoriteIds.includes(book.id) ? 'from' : 'to'} favourites`} onClick={() => toggleFavorite(book.id)} className={`shrink-0 rounded-full p-1.5 ${favoriteIds.includes(book.id) ? 'bg-rose-100 text-rose-600' : 'bg-[#f3f8f4] text-[#20352B]'}`}><Heart className={`h-3.5 w-3.5 ${favoriteIds.includes(book.id) ? 'fill-current' : ''}`} /></button>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-8 text-[10px] leading-4 text-[#597162]">{reason}</p>
                  <div className="mt-2 flex gap-2"><button onClick={() => addToLibrary(book.id)} className="flex-1 rounded-full bg-[#28634C] px-2 py-2 text-[10px] font-semibold text-white">Save it</button><button onClick={() => navigate(`/book/${book.id}`)} className="flex-1 rounded-full border border-[#dfe5e0] bg-white/70 px-2 py-2 text-[10px] font-semibold text-[#20352B]">View details</button></div>
                </article>
              )
            })}
          </div>
          {recommendations.length === 0 && !recommendationError && <p className="rounded-xl bg-white/50 p-4 text-center text-xs text-[#597162]">No recommendations are available yet. Set your preferences or generate matches to get started.</p>}
        </section>
      </div>
    </AppShell>
  )
}

function LibraryPage({ onLogout, library, favoriteIds, toggleFavorite, addToLibrary, updateStatus }: { onLogout: () => void; library: { id: string; shelf: string }[]; favoriteIds: string[]; toggleFavorite: (bookId: string) => void; addToLibrary: (bookId: string) => void; updateStatus: (bookId: string, status: string) => void }) {
  const [selectedTab, setSelectedTab] = useState('All Books')
  const [libraryBooks, setLibraryBooks] = useState<Array<{ book: Book; status: string }>>([])
  const [favouriteBooks, setFavouriteBooks] = useState<Book[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([
      apiRequest<Array<ApiBook & { status: string }>>('/api/library'),
      apiRequest<ApiBook[]>('/api/favourites'),
    ]).then(([libraryResponse, favouriteResponse]) => {
      if (!active) return
      setLibraryBooks(libraryResponse.map(({ status, ...book }) => ({ book: mapApiBook(book), status })))
      setFavouriteBooks(favouriteResponse.map(mapApiBook))
      setError('')
    }).catch((requestError: unknown) => {
      if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load your library.')
    })
    return () => {
      active = false
    }
  }, [library, favoriteIds])

  const filteredBooks = selectedTab === 'Favourites'
    ? favouriteBooks.map((book) => ({ book, status: '' }))
    : libraryBooks.filter(({ status }) => selectedTab === 'All Books'
      || (selectedTab === 'Want to Read' && status === 'want_to_read')
      || (selectedTab === 'Currently Reading' && status === 'currently_reading')
      || (selectedTab === 'Completed' && status === 'completed'))

  return (
    <AppShell pageTitle="My Library" subtitle="Bookshelf" onLogout={onLogout}>
      {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
        <div className="mb-5 flex flex-wrap gap-2">
          {['All Books', 'Favourites', 'Want to Read', 'Currently Reading', 'Completed'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${selectedTab === tab ? 'bg-[#28634C] text-white' : 'border border-[#dfe5e0] bg-white/60 text-[#20352B]'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredBooks.map(({ book, status }) => (
            <div key={book.id} className="overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-3">
              <img src={book.cover} alt={book.title} className="h-56 w-full rounded-[20px] object-cover" />
              <div className="mt-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-[#718477]">{book.genre}</p>
                    <h4 className="mt-2 text-xl font-semibold text-[#20352B]">{book.title}</h4>
                  </div>
                  <button onClick={() => toggleFavorite(book.id)} className={`rounded-full p-2 ${favoriteIds.includes(book.id) ? 'bg-rose-100 text-rose-600' : 'bg-[#f3f8f4] text-[#20352B]'}`}>
                    <Heart className={`h-4 w-4 ${favoriteIds.includes(book.id) ? 'fill-current' : ''}`} />
                  </button>
                </div>
                <p className="text-sm text-[#597162]">by {book.author}</p>
                <div className="flex items-center justify-between text-sm text-[#597162]">
                  <span>{book.matchScore}% match</span>
                  {libraryBooks.some((entry) => entry.book.id === book.id) ? (
                    <select
                      aria-label={`Reading status for ${book.title}`}
                      value={status}
                      onChange={(event) => updateStatus(book.id, event.target.value)}
                      className="rounded-full border border-[#dfe5e0] bg-white/80 px-3 py-1.5 text-xs font-medium text-[#20352B]"
                    >
                      <option value="want_to_read">Want to Read</option>
                      <option value="currently_reading">Currently Reading</option>
                      <option value="completed">Completed</option>
                    </select>
                  ) : (
                    <button onClick={() => addToLibrary(book.id)} className="rounded-full border border-[#dfe5e0] bg-white/80 px-3 py-1.5 text-xs font-medium text-[#20352B]">Save</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {filteredBooks.length === 0 && (
          <div className="mt-4 rounded-[24px] border border-white/40 bg-white/40 p-8 text-center">
            <h3 className="text-lg font-semibold text-[#20352B]">This shelf is waiting for its first book</h3>
            <p className="mt-2 text-sm text-[#597162]">Save books from your discoveries and they’ll appear here.</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function SectionCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[24px] border border-white/65 bg-white/40 p-4 shadow-[0_12px_30px_rgba(32,53,43,0.07)] backdrop-blur-xl sm:p-5 ${className}`}>
      {children}
    </section>
  )
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#718477]">{eyebrow}</p>
        <h3 className="mt-1 text-xl font-semibold text-[#20352B] sm:text-2xl">{title}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[#597162] sm:text-sm">{description}</p>
      </div>
      {action}
    </div>
  )
}

function RecommendationsPage({ onLogout, favoriteIds, toggleFavorite, addToLibrary, addToCart }: { onLogout: () => void; favoriteIds: string[]; toggleFavorite: (bookId: string) => void; addToLibrary: (bookId: string) => void; addToCart: (bookId: string) => void }) {
  const navigate = useNavigate()
  const [results, setResults] = useState<Array<{ book: Book; score: number; category: string; reason: string }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadRecommendations = async (generate = false) => {
    if (generate) {
      setIsLoading(true)
      setError('')
    }
    try {
      if (generate) {
        await apiRequest('/api/recommendations/generate', {
          method: 'POST',
          body: JSON.stringify({ books: [] }),
        })
      }
      const entries = await apiRequest<Array<{ book_id: string; category: string; match_score: number; reason: string }>>('/api/recommendations')
      const hydrated = await Promise.all(entries.map(async (entry) => {
        const detail = await apiRequest<ApiBook>(`/api/books/${encodeURIComponent(entry.book_id)}`)
        return { book: mapApiBook(detail), score: entry.match_score, category: entry.category, reason: entry.reason }
      }))
      setResults(hydrated)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load recommendations.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadRecommendations()
  }, [])

  return (
    <AppShell pageTitle="Recommendations" subtitle="Your next great read" onLogout={onLogout}>
      <SectionCard>
        <PageIntro
          eyebrow="Made for your shelf"
          title="Your Next Recommended Read"
          description="Book matches based on your saved reading interests and bookshelf."
          action={<GlassButton className="px-4 py-2.5 text-xs" onClick={() => void loadRecommendations(true)}>Refresh matches</GlassButton>}
        />
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {isLoading ? <p className="rounded-2xl bg-white/45 p-5 text-sm text-[#597162]">Finding books that fit your shelf…</p> : null}
        {!isLoading && results.length === 0 && !error && (
          <div className="rounded-2xl border border-dashed border-[#b8d8c5] bg-white/35 p-7 text-center">
            <BookOpenText className="mx-auto h-8 w-8 text-[#397B5C]" />
            <h4 className="mt-3 font-semibold text-[#20352B]">Your next recommendation is one click away</h4>
            <p className="mt-1 text-sm text-[#597162]">Save your preferences, then generate a personalized list.</p>
            <button type="button" onClick={() => void loadRecommendations(true)} className="mt-4 rounded-full bg-[#28634C] px-4 py-2 text-sm font-semibold text-white">Generate recommendations</button>
          </div>
        )}
        {!isLoading && results.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {results.map(({ book, score, category, reason }) => (
              <article key={book.id} className="rounded-[20px] border border-white/70 bg-white/45 p-3">
                <div className="flex gap-3">
                  <img src={book.cover} alt={book.title} className="h-36 w-24 shrink-0 rounded-xl object-cover shadow-md" />
                  <div className="min-w-0 flex-1">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold tracking-wide ${categoryStyles[category] ?? categoryStyles['SAVE IT']}`}>{category}</span>
                    <h4 className="mt-2 line-clamp-2 text-sm font-semibold text-[#20352B]">{book.title}</h4>
                    <p className="mt-1 text-[11px] text-[#597162]">{book.author}</p>
                    <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#28634C]"><Star className="h-3 w-3 fill-current" /> {score}% match</div>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-9 text-[11px] leading-5 text-[#597162]">{reason}</p>
                <p className="mb-2 text-[10px] font-medium text-[#28634C]">{book.priceAmount !== null && book.priceAmount !== undefined && book.priceCurrency ? `${book.priceCurrency} ${book.priceAmount.toFixed(2)} · ${book.retailerName}` : 'Verified price unavailable'}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => addToLibrary(book.id)} className="rounded-full bg-[#28634C] px-3 py-2 text-[11px] font-semibold text-white">Save</button>
                  <button type="button" onClick={() => addToCart(book.id)} className="rounded-full border border-[#dfe5e0] bg-white/65 px-3 py-2 text-[11px] font-semibold text-[#28634C]">Add to cart</button>
                  <button type="button" onClick={() => navigate(`/book/${book.id}`)} className="rounded-full border border-[#dfe5e0] bg-white/65 px-3 py-2 text-[11px] font-semibold text-[#28634C]">Details</button>
                  <button type="button" aria-label={`${favoriteIds.includes(book.id) ? 'Remove' : 'Add'} ${book.title} ${favoriteIds.includes(book.id) ? 'from' : 'to'} favourites`} onClick={() => toggleFavorite(book.id)} className="rounded-full border border-[#dfe5e0] bg-white/65 p-2 text-[#28634C]"><Heart className={`h-3.5 w-3.5 ${favoriteIds.includes(book.id) ? 'fill-rose-500 text-rose-500' : ''}`} /></button>
                </div>
                <div className="mt-2 flex gap-2">
                  {book.retailerUrl ? <a href={book.retailerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-2 text-[10px] font-semibold text-[#28634C]">Buy now <ArrowUpRight className="h-3 w-3" /></a> : <span className="rounded-full bg-white/60 px-3 py-2 text-[10px] text-[#718477]">Purchase link unavailable</span>}
                  <button type="button" onClick={() => navigate('/store')} className="rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-2 text-[10px] font-semibold text-[#28634C]">Explore bookstore</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </AppShell>
  )
}

function ShelfPersonalityPage({ onLogout, selectedGenres }: { onLogout: () => void; selectedGenres: string[] }) {
  const navigate = useNavigate()
  const displayedGenres = selectedGenres.slice(0, 4)

  return (
    <AppShell pageTitle="Shelf Personality" subtitle="Your reading identity" onLogout={onLogout}>
      <SectionCard>
        <PageIntro eyebrow="Your reading profile" title="Your Shelf Personality" description="A view of the genres you have saved in your reading preferences." action={<button type="button" onClick={() => navigate('/onboarding')} className="rounded-full border border-[#dfe5e0] bg-white/65 px-4 py-2 text-xs font-semibold text-[#28634C]">Edit preferences</button>} />
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-[20px] bg-gradient-to-br from-[#eef7ef] to-white/55 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#dcefe1] text-[#28634C]"><BookOpenText className="h-5 w-5" /></div>
              <div><h4 className="text-sm font-semibold text-[#20352B]">Saved reading interests</h4><p className="text-xs text-[#597162]">{selectedGenres.length} genre preferences</p></div>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#597162]">{selectedGenres.length ? `Your saved genres are ${selectedGenres.join(', ')}.` : 'Choose your favourite genres to personalize your reading profile.'}</p>
            <button type="button" onClick={() => navigate('/recommendations')} className="mt-4 rounded-full bg-[#28634C] px-5 py-2.5 text-xs font-semibold text-white">Explore recommendations</button>
          </div>
          <div className="relative mx-auto flex h-64 w-64 items-center justify-center rounded-full border border-[#dbe9de] bg-[radial-gradient(circle,#f9fcf9_0%,#e4f1e7_70%)]">
            <div className="absolute inset-8 rounded-full border border-[#c7ddce]" /><div className="absolute inset-16 rounded-full border border-[#c7ddce]" />
            <div className="absolute h-px w-48 bg-[#d1e4d7]" /><div className="absolute h-48 w-px bg-[#d1e4d7]" />
            <div className="relative h-36 w-36 [clip-path:polygon(50%_0%,95%_35%,78%_95%,22%_95%,5%_35%)] bg-[#4d9470]/65" />
            {displayedGenres.map((genre, index) => {
              const points = ['top-2 left-1/2 -translate-x-1/2', 'right-0 top-[28%]', 'right-8 bottom-4', 'left-8 bottom-4']
              return <span key={genre} className={`absolute ${points[index]} rounded-full border border-white/70 bg-white/75 px-2 py-1 text-[9px] font-medium text-[#28634C] shadow-sm`}>{genre}</span>
            })}
            {displayedGenres.length === 0 && <span className="absolute rounded-full border border-white/70 bg-white/75 px-2 py-1 text-[9px] font-medium text-[#28634C] shadow-sm">No saved genres</span>}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {selectedGenres.map((genre) => <span key={genre} className="rounded-full border border-[#d5e6da] bg-[#edf6ef] px-3 py-1.5 text-xs font-medium text-[#28634C]">{genre}</span>)}
        </div>
      </SectionCard>
    </AppShell>
  )
}

function ReadingTwinPage({ onLogout, selectedGenres }: { onLogout: () => void; selectedGenres: string[] }) {
  const navigate = useNavigate()
  const [otherGenresInput, setOtherGenresInput] = useState('')
  const normalize = (genre: string) => genre.toLocaleLowerCase()
  const savedGenres = [...new Map(selectedGenres.map((genre) => [normalize(genre), genre])).values()]
  const otherGenres = [...new Map(otherGenresInput.split(',').map((genre) => genre.trim()).filter(Boolean).map((genre) => [normalize(genre), genre])).values()]
  const sharedGenres = savedGenres.filter((genre) => otherGenres.some((other) => normalize(other) === normalize(genre)))
  const allGenres = new Set([...savedGenres, ...otherGenres].map(normalize))
  const matchPercentage = otherGenres.length && allGenres.size
    ? Math.round(sharedGenres.length / allGenres.size * 100)
    : null

  return (
    <AppShell pageTitle="Reading Twin" subtitle="Readers like you" onLogout={onLogout}>
      <SectionCard>
        <PageIntro eyebrow="Find your bookish match" title="Your Reading Twin" description="Compare your saved genres with another reader's shared interests. Only the genres you enter are used; other users' private accounts are not exposed." />
        <div className="grid gap-4 md:grid-cols-[0.85fr_1.15fr]">
          <div className="flex flex-col items-center justify-center rounded-[20px] bg-gradient-to-br from-[#e7f2e9] to-[#fbfdfb] p-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-[#b8d8c5] text-[#28634C] shadow-md"><Users className="h-8 w-8" /></div>
            <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-[#718477]">Genre overlap</p>
            <h4 className="mt-1 text-lg font-semibold text-[#20352B]">{matchPercentage === null ? 'Add shared genres' : `${matchPercentage}% genre match`}</h4>
            <p className="mt-1 text-xs text-[#597162]">{matchPercentage === null ? 'Enter a comma-separated genre list to compare.' : `${sharedGenres.length} shared out of ${allGenres.size} unique genres`}</p>
          </div>
          <div className="rounded-[20px] border border-white/65 bg-white/45 p-4">
            <h4 className="text-sm font-semibold text-[#20352B]">Your saved genres</h4>
            <div className="mt-3 flex flex-wrap gap-2">{savedGenres.map((genre) => <span key={genre} className="rounded-full border border-[#d5e6da] bg-[#edf6ef] px-3 py-1.5 text-[11px] font-medium text-[#28634C]">{genre}</span>)}{savedGenres.length === 0 && <p className="text-xs text-[#718477]">No reading preferences saved yet.</p>}</div>
            <label htmlFor="reading-twin-genres" className="mt-5 block text-sm font-semibold text-[#20352B]">Other reader's shared genres</label>
            <input id="reading-twin-genres" value={otherGenresInput} onChange={(event) => setOtherGenresInput(event.target.value)} placeholder="Mystery, Fantasy, Romance" className="mt-2 w-full rounded-xl border border-[#dfe5e0] bg-white/75 px-3 py-2.5 text-xs text-[#20352B] outline-none" />
            {matchPercentage !== null && <div className="mt-4"><h5 className="text-xs font-semibold text-[#20352B]">Shared interests</h5><div className="mt-2 flex flex-wrap gap-2">{sharedGenres.map((genre) => <span key={genre} className="rounded-full bg-[#e8f3ea] px-3 py-1.5 text-[11px] text-[#28634C]">{genre}</span>)}{sharedGenres.length === 0 && <p className="text-xs text-[#718477]">No shared genres in these lists.</p>}</div></div>}
            <button type="button" onClick={() => navigate(`/comparison?genres=${encodeURIComponent(otherGenres.join(','))}`)} className="mt-4 rounded-full bg-[#28634C] px-4 py-2 text-xs font-semibold text-white">Compare shelves</button>
          </div>
        </div>
      </SectionCard>
    </AppShell>
  )
}

function ShelfComparisonPage({ onLogout, selectedGenres }: { onLogout: () => void; selectedGenres: string[] }) {
  const [searchParams] = useSearchParams()
  const [otherGenresInput, setOtherGenresInput] = useState(searchParams.get('genres') ?? '')
  const normalize = (genre: string) => genre.toLocaleLowerCase()
  const savedGenres = [...new Map(selectedGenres.map((genre) => [normalize(genre), genre])).values()]
  const otherGenres = [...new Map(otherGenresInput.split(',').map((genre) => genre.trim()).filter(Boolean).map((genre) => [normalize(genre), genre])).values()]
  const userGenreSet = new Set(savedGenres.map(normalize))
  const otherGenreSet = new Set(otherGenres.map(normalize))
  const sharedGenres = savedGenres.filter((genre) => otherGenreSet.has(normalize(genre)))
  const unionSize = new Set([...userGenreSet, ...otherGenreSet]).size
  const matchPercentage = otherGenres.length && unionSize
    ? Math.round(sharedGenres.length / unionSize * 100)
    : null

  return (
    <AppShell pageTitle="Smart Shelf Comparison" subtitle="Compare reading tastes" onLogout={onLogout}>
      <SectionCard>
        <PageIntro eyebrow="Side by side" title="Shelf Comparison" description="Compare your saved genre preferences with another shelf's shared genre list." />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[20px] border border-white/65 bg-white/45 p-4">
            <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-[#20352B]">Your Shelf</h4><span className="rounded-full bg-[#e8f3ea] px-3 py-1 text-[10px] font-semibold text-[#28634C]">{selectedGenres.length} genres</span></div>
            <div className="mt-4 flex min-h-28 flex-wrap content-start gap-2 rounded-xl bg-[#f0f7f1] p-3">{savedGenres.map((genre) => <span key={genre} className="h-fit rounded-full border border-[#d9e7dc] bg-white/75 px-2.5 py-1 text-[10px] text-[#597162]">{genre}</span>)}{savedGenres.length === 0 && <p className="text-xs text-[#718477]">Save reading preferences to compare your shelf.</p>}</div>
          </div>
          <div className="rounded-[20px] border border-white/65 bg-white/45 p-4">
            <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-[#20352B]">Other Shelf</h4><span className="rounded-full bg-[#e8f3ea] px-3 py-1 text-[10px] font-semibold text-[#28634C]">{otherGenres.length} genres</span></div>
            <label htmlFor="comparison-genres" className="sr-only">Other shelf genres</label>
            <textarea id="comparison-genres" value={otherGenresInput} onChange={(event) => setOtherGenresInput(event.target.value)} placeholder="Enter shared genres, separated by commas" className="mt-4 min-h-28 w-full resize-y rounded-xl border border-[#d9e7dc] bg-white/75 p-3 text-xs text-[#20352B] outline-none" />
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-gradient-to-r from-[#eaf5ec] to-white/55 p-4">
          <p className="text-sm font-semibold text-[#28634C]">{matchPercentage === null ? 'Add another shelf to compare' : `${matchPercentage}% genre overlap`}</p>
          {matchPercentage !== null && <p className="mt-1 text-xs text-[#597162]">{sharedGenres.length} shared genres out of {unionSize} unique genres.</p>}
          {matchPercentage !== null && <div className="mt-3 flex flex-wrap gap-2">{sharedGenres.map((genre) => <span key={genre} className="rounded-full border border-[#d5e6da] bg-white/75 px-3 py-1 text-[10px] text-[#28634C]">{genre}</span>)}{sharedGenres.length === 0 && <span className="text-xs text-[#718477]">These shelves have no matching genres.</span>}</div>}
        </div>
      </SectionCard>
    </AppShell>
  )
}

function BookAssistantPage({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [messages, setMessages] = useState<Array<{ role: 'assistant' | 'reader'; text: string; books?: Book[] }>>([
    { role: 'assistant', text: 'Hello! Tell me what you are in the mood to read, and I will look for grounded matches in the Shelf Scan catalogue.' },
  ])
  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prompt = question.trim()
    if (!prompt || isSending) return
    setMessages((current) => [...current, { role: 'reader', text: prompt }])
    setQuestion('')
    setIsSending(true)
    try {
      const response = await apiRequest<{ message: string; books: ApiBook[] }>('/api/assistant/ask', {
        method: 'POST',
        body: JSON.stringify({ question: prompt }),
      })
      setMessages((current) => [...current, {
        role: 'assistant',
        text: response.message,
        books: response.books.map(mapApiBook),
      }])
    } catch (requestError) {
      setMessages((current) => [...current, {
        role: 'assistant',
        text: requestError instanceof Error ? requestError.message : 'The book assistant could not answer right now.',
      }])
    } finally {
      setIsSending(false)
    }
  }

  return (
    <AppShell pageTitle="AI Book Assistant" subtitle="Your reading companion" onLogout={onLogout}>
      <SectionCard className="mx-auto flex min-h-[min(70vh,680px)] max-w-4xl flex-col">
        <PageIntro eyebrow="Ask your book assistant" title="What would you love to read?" description="Describe a mood, genre, or story you enjoy." />
        <div aria-live="polite" aria-busy={isSending} className="flex-1 space-y-3 overflow-y-auto rounded-[20px] bg-[#f3f8f4]/80 p-3 sm:p-4">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === 'reader' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-3 py-2.5 text-xs leading-5 sm:text-sm ${message.role === 'reader' ? 'bg-[#28634C] text-white' : 'border border-white/70 bg-white/80 text-[#20352B]'}`}>
                <p>{message.text}</p>
                {message.books?.map((book) => <button key={book.id} type="button" onClick={() => navigate(`/book/${book.id}`)} className="mt-2 mr-2 inline-flex items-center gap-1 font-semibold text-[#28634C]">View {book.title}<ArrowUpRight className="h-3 w-3" /></button>)}
              </div>
            </div>
          ))}
          {isSending && <p className="text-xs text-[#718477]">Checking your reading profile and catalogue…</p>}
        </div>
        <form onSubmit={(event) => void sendMessage(event)} className="mt-3 flex gap-2 rounded-full border border-[#dfe5e0] bg-white/70 p-1.5">
          <label htmlFor="assistant-question" className="sr-only">Ask about books</label>
          <input id="assistant-question" value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="I am in the mood for a cozy mystery…" className="min-w-0 flex-1 bg-transparent px-3 text-xs text-[#20352B] outline-none sm:text-sm" />
          <button type="submit" disabled={isSending || !question.trim()} aria-label="Send message" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#28634C] text-white disabled:opacity-50"><Send className="h-4 w-4" /></button>
        </form>
        <p className="mt-2 flex items-center gap-1 text-[10px] text-[#718477]"><MessageCircle className="h-3 w-3" /> Suggestions are grounded in the Shelf Scan catalogue and require the backend AI service.</p>
      </SectionCard>
    </AppShell>
  )
}

function BookStorePage({
  onLogout,
  addToLibrary,
  addToCart,
  favoriteIds,
  toggleFavorite,
}: {
  onLogout: () => void
  addToLibrary: (bookId: string) => void
  addToCart: (bookId: string) => void
  favoriteIds: string[]
  toggleFavorite: (bookId: string) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')
  const [results, setResults] = useState<Book[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (genre) params.set('genre', genre)
      setIsLoading(true)
      setError('')
      void apiRequest<ApiBook[]>(`/api/books/search?${params.toString()}`)
        .then((booksResponse) => {
          if (active) setResults(booksResponse.map(mapApiBook))
        })
        .catch((requestError: unknown) => {
          if (active) setError(requestError instanceof Error ? requestError.message : 'Could not search the book catalogue.')
        })
        .finally(() => {
          if (active) setIsLoading(false)
        })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, genre])

  return (
    <AppShell pageTitle="Book Store" subtitle="Browse the catalogue" onLogout={onLogout}>
      <SectionCard>
        <PageIntro eyebrow="Find your next favourite" title="Book Store" description="Browse book details, explore your matches, and save titles to your reading list." />
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="flex items-center gap-2 rounded-full border border-[#dfe5e0] bg-white/65 px-4 py-2.5 text-[#718477]"><Search className="h-4 w-4" /><span className="sr-only">Search title, author or ISBN</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author or ISBN…" className="w-full bg-transparent text-xs text-[#20352B] outline-none sm:text-sm" /></label>
          <label className="sr-only" htmlFor="book-genre">Filter by genre</label>
          <select id="book-genre" value={genre} onChange={(event) => setGenre(event.target.value)} className="rounded-full border border-[#dfe5e0] bg-white/65 px-4 py-2.5 text-xs text-[#20352B]">
            <option value="">All genres</option>
            {['Fiction', 'Fantasy', 'Romance', 'Technology', 'Mystery', 'Self-help', 'Psychological Thriller', 'Science Fiction', 'History'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {isLoading && <p className="mb-4 rounded-xl bg-white/50 p-4 text-sm text-[#597162]">Searching the connected catalogues…</p>}
        {!error && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((book) => <article key={book.id} className="flex gap-3 rounded-[20px] border border-white/70 bg-white/45 p-3">
            <img src={book.cover} alt={book.title} className="h-36 w-24 rounded-xl object-cover shadow-sm" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[9px] uppercase tracking-[0.14em] text-[#718477]">{book.genre}</span><h4 className="mt-1 text-sm font-semibold text-[#20352B]">{book.title}</h4><p className="mt-1 text-[11px] text-[#597162]">{book.author}</p>
              <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#597162]">{book.description}</p>
              {book.averageRating !== null && book.averageRating !== undefined && <p className="mt-2 text-[10px] text-[#597162]">Rating {book.averageRating}{book.ratingsCount ? ` (${book.ratingsCount})` : ''}</p>}
              <p className="mt-2 text-[10px] font-medium text-[#28634C]">{book.priceAmount !== null && book.priceAmount !== undefined && book.priceCurrency ? `${book.priceCurrency} ${book.priceAmount.toFixed(2)} · ${book.retailerName}` : 'Verified price unavailable'}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                <button type="button" onClick={() => addToLibrary(book.id)} className="rounded-full bg-[#28634C] px-3 py-2 text-[10px] font-semibold text-white">Add to library</button>
                <button type="button" onClick={() => addToCart(book.id)} className="rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-2 text-[10px] font-semibold text-[#28634C]">Add to cart</button>
                <button type="button" onClick={() => toggleFavorite(book.id)} aria-label={`${favoriteIds.includes(book.id) ? 'Remove' : 'Add'} ${book.title} ${favoriteIds.includes(book.id) ? 'from' : 'to'} wishlist`} className="rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-2 text-[10px] font-semibold text-[#28634C]">{favoriteIds.includes(book.id) ? 'Wishlisted' : 'Wishlist'}</button>
                <button type="button" onClick={() => navigate(`/book/${book.id}`)} className="rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-2 text-[10px] font-semibold text-[#28634C]">Details</button>
                {book.retailerUrl && <a href={book.retailerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-2 text-[10px] font-semibold text-[#28634C]">Buy now <ArrowUpRight className="h-3 w-3" /></a>}
              </div>
            </div>
          </article>)}
        </div>}
        {!isLoading && !error && results.length === 0 && <p className="rounded-xl bg-white/55 p-4 text-center text-sm text-[#597162]">No books match that search.</p>}
      </SectionCard>
    </AppShell>
  )
}

function ShoppingCartPage({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate()
  const [cart, setCart] = useState<{
    items: Array<{ quantity: number; line_total: number | null; book: ApiBook }>
    subtotal: number | null
    total: number | null
    currency: string | null
    prices_available: boolean
    price_unavailable_count: number
    purchase_note: string
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    void apiRequest<typeof cart>('/api/cart')
      .then((response) => {
        if (active) {
          setCart(response)
          setError('')
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load your cart.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const updateQuantity = async (bookId: string, quantity: number) => {
    try {
      setCart(await apiRequest(`/api/cart/${encodeURIComponent(bookId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      }))
      setQuantityDrafts((current) => {
        const next = { ...current }
        delete next[bookId]
        return next
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update cart quantity.')
    }
  }

  const commitQuantity = (bookId: string, originalQuantity: number) => {
    const draft = quantityDrafts[bookId]
    if (draft === undefined) return
    const quantity = Number(draft)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      setQuantityDrafts((current) => {
        const next = { ...current }
        delete next[bookId]
        return next
      })
      setError('Cart quantity must be a whole number between 1 and 99.')
      return
    }
    if (quantity !== originalQuantity) void updateQuantity(bookId, quantity)
    else setQuantityDrafts((current) => {
      const next = { ...current }
      delete next[bookId]
      return next
    })
  }

  const removeItem = async (bookId: string) => {
    try {
      setCart(await apiRequest(`/api/cart/${encodeURIComponent(bookId)}`, { method: 'DELETE' }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not remove this book from your cart.')
    }
  }

  return (
    <AppShell pageTitle="Shopping Cart" subtitle="Your selected books" onLogout={onLogout}>
      <SectionCard>
        <PageIntro eyebrow="Book Store" title="Shopping Cart" description="Review quantities and any provider-supplied prices. Purchases are completed with the retailer, not through Shelf Scan." action={<button type="button" onClick={() => navigate('/store')} className="rounded-full border border-[#dfe5e0] bg-white/70 px-4 py-2 text-xs font-semibold text-[#28634C]">Continue browsing</button>} />
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {loading && <p className="rounded-xl bg-white/50 p-4 text-sm text-[#597162]">Loading your cart…</p>}
        {!loading && cart && cart.items.length > 0 && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            {cart.items.map(({ book: rawBook, quantity, line_total }) => {
              const book = mapApiBook(rawBook)
              return <article key={book.id} className="flex flex-wrap gap-3 rounded-[20px] border border-white/70 bg-white/45 p-3 sm:flex-nowrap">
                <img src={book.cover} alt={book.title} className="h-28 w-20 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-[#20352B]">{book.title}</h4>
                  <p className="mt-1 text-xs text-[#597162]">{book.author}</p>
                  <p className="mt-2 text-xs font-medium text-[#28634C]">{book.priceAmount != null && book.priceCurrency ? `${book.priceCurrency} ${book.priceAmount.toFixed(2)} each` : 'Verified price unavailable'}</p>
                  {line_total !== null && book.priceCurrency && <p className="mt-1 text-xs text-[#597162]">Line total: {book.priceCurrency} {line_total.toFixed(2)}</p>}
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-[10px] text-[#718477]" htmlFor={`quantity-${book.id}`}>Quantity</label>
                    <input id={`quantity-${book.id}`} type="number" min={1} max={99} value={quantityDrafts[book.id] ?? quantity} onChange={(event) => setQuantityDrafts((current) => ({ ...current, [book.id]: event.target.value }))} onBlur={() => commitQuantity(book.id, quantity)} onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }} className="w-16 rounded-lg border border-[#dfe5e0] bg-white/80 px-2 py-1 text-xs text-[#20352B]" />
                    <button type="button" onClick={() => void removeItem(book.id)} className="ml-auto rounded-full border border-[#dfe5e0] bg-white/70 px-3 py-1.5 text-[10px] font-semibold text-rose-700">Remove</button>
                  </div>
                </div>
                {book.retailerUrl && <a href={book.retailerUrl} target="_blank" rel="noreferrer" className="self-center rounded-full bg-[#28634C] px-3 py-2 text-[10px] font-semibold text-white">Buy now <ArrowUpRight className="ml-1 inline h-3 w-3" /></a>}
              </article>
            })}
          </div>
          <aside className="h-fit rounded-[20px] border border-white/70 bg-white/50 p-4">
            <h4 className="text-sm font-semibold text-[#20352B]">Cart summary</h4>
            {cart.prices_available && cart.currency ? <div className="mt-4 flex justify-between text-sm text-[#20352B]"><span>Estimated subtotal</span><strong>{cart.currency} {cart.subtotal?.toFixed(2)}</strong></div> : <p className="mt-3 text-xs leading-5 text-[#718477]">Subtotal unavailable because a current provider price is missing or currencies differ.</p>}
            <p className="mt-2 text-xs text-[#718477]">Final total is set by the retailer and is unavailable here.</p>
            <p className="mt-3 text-[10px] leading-4 text-[#718477]">{cart.purchase_note}</p>
            <p className="mt-2 text-[10px] text-[#718477]">Retailer availability and prices may change; verify them at the retailer.</p>
          </aside>
        </div>}
        {!loading && cart?.items.length === 0 && <div className="rounded-xl bg-white/55 p-6 text-center"><p className="text-sm text-[#597162]">Your cart is empty.</p><button type="button" onClick={() => navigate('/store')} className="mt-3 rounded-full bg-[#28634C] px-4 py-2 text-xs font-semibold text-white">Explore the bookstore</button></div>}
      </SectionCard>
    </AppShell>
  )
}

function AdminDashboardPage({ onLogout }: { onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<{
    total_users: number
    active_users: number
    inactive_users: number
    activity_window_minutes: number
    recently_registered: Array<{ id: string; full_name: string; email: string; created_at: string | null }>
    recent_login_history: Array<{ id: string; user_name: string; email: string; login_at: string; logout_at: string | null; session_status: string }>
  } | null>(null)
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; email: string; created_at: string | null; last_login_at: string | null; last_active_at: string | null; account_status: string }>>([])
  const [analytics, setAnalytics] = useState<{ registrations_total: number; logins_total: number; period_days: number } | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void Promise.all([
      apiRequest<typeof dashboard>('/api/admin/dashboard'),
      apiRequest<typeof analytics>('/api/admin/analytics'),
    ]).then(([dashboardResponse, analyticsResponse]) => {
      if (dashboardResponse) setDashboard(dashboardResponse)
      if (analyticsResponse) setAnalytics(analyticsResponse)
    }).catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : 'Could not load administrator analytics.')
    })
  }, [])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''
      void apiRequest<{ items: typeof users }>(`/api/admin/users${query}`)
        .then((response) => {
          if (active) setUsers(response.items)
        })
        .catch((requestError: unknown) => {
          if (active) setError(requestError instanceof Error ? requestError.message : 'Could not search users.')
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search])

  return (
    <AppShell pageTitle="Admin Dashboard" subtitle="Application overview" onLogout={onLogout}>
      <SectionCard>
        <PageIntro eyebrow="Shelf Scan overview" title="Admin Dashboard" description={`User registration and login activity. Active means activity within the last ${dashboard?.activity_window_minutes ?? 30} minutes.`} />
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          {[{ label: 'Registered users', value: dashboard?.total_users ?? '—', icon: Users }, { label: 'Active users', value: dashboard?.active_users ?? '—', icon: BarChart3 }, { label: 'Inactive users', value: dashboard?.inactive_users ?? '—', icon: BookOpenText }].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-[18px] border border-white/70 bg-white/50 p-4"><div className="flex items-center justify-between"><span className="text-xs text-[#597162]">{label}</span><Icon className="h-4 w-4 text-[#397B5C]" /></div><p className="mt-3 text-2xl font-semibold text-[#20352B]">{value}</p></div>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[18px] border border-white/65 bg-white/45 p-4"><p className="text-xs text-[#718477]">Last 30 days</p><p className="mt-2 text-sm font-medium text-[#20352B]">{analytics?.registrations_total ?? '—'} registrations · {analytics?.logins_total ?? '—'} successful logins</p></div>
          <div className="rounded-[18px] border border-white/65 bg-white/45 p-4"><p className="text-xs text-[#718477]">Recently registered</p><div className="mt-2 space-y-2">{dashboard?.recently_registered.map((user) => <div key={user.id} className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-medium text-[#20352B]">{user.full_name} · {user.email}</span><time className="text-[#718477]">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</time></div>)}</div></div>
        </div>
        <label className="mt-5 flex items-center gap-2 rounded-full border border-[#dfe5e0] bg-white/65 px-4 py-2.5 text-[#718477]"><Search className="h-4 w-4" /><span className="sr-only">Search users by name or email</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users by name or email…" className="w-full bg-transparent text-xs text-[#20352B] outline-none sm:text-sm" /></label>
        <div className="mt-3 overflow-x-auto rounded-[18px] border border-white/65 bg-white/45">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-[#e3ece5] text-[10px] uppercase tracking-[0.12em] text-[#718477]"><tr><th className="px-3 py-3">User</th><th className="px-3 py-3">Registered</th><th className="px-3 py-3">Last login</th><th className="px-3 py-3">Last active</th><th className="px-3 py-3">Account status</th></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id} className="border-b border-[#e9f0ea] last:border-0"><td className="px-3 py-3"><span className="font-medium text-[#20352B]">{user.full_name}</span><span className="block text-[#718477]">{user.email}</span></td><td className="px-3 py-3 text-[#597162]">{user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</td><td className="px-3 py-3 text-[#597162]">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}</td><td className="px-3 py-3 text-[#597162]">{user.last_active_at ? new Date(user.last_active_at).toLocaleString() : '—'}</td><td className="px-3 py-3 capitalize text-[#28634C]">{user.account_status}</td></tr>)}</tbody>
          </table>
          {users.length === 0 && <p className="p-4 text-center text-xs text-[#597162]">No users matched this search.</p>}
        </div>
        <div className="mt-5 rounded-[18px] border border-white/65 bg-white/45 p-4">
          <h4 className="text-sm font-semibold text-[#20352B]">Recent login history</h4>
          <div className="mt-3 space-y-2">{dashboard?.recent_login_history.map((record) => <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e9f0ea] pb-2 text-xs last:border-0"><span className="text-[#20352B]">{record.user_name} · {record.email}</span><span className="text-[#718477]">{new Date(record.login_at).toLocaleString()} · {record.session_status}</span></div>)}</div>
          {dashboard?.recent_login_history.length === 0 && <p className="mt-2 text-xs text-[#597162]">No successful logins have been recorded.</p>}
        </div>
      </SectionCard>
    </AppShell>
  )
}

function SettingsPage({ onLogout, user, selectedGenres, setSelectedGenres }: { onLogout: () => void; user: AuthUser | null; selectedGenres: string[]; setSelectedGenres: Dispatch<SetStateAction<string[]>> }) {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [preferenceDetails, setPreferenceDetails] = useState({
    favourite_authors: [] as string[],
    reading_categories: [] as string[],
    reading_habits: [] as string[],
    books_enjoyed_previously: [] as string[],
  })

  useEffect(() => {
    void apiRequest<{ favourite_genres?: string[]; favourite_authors?: string[]; reading_categories?: string[]; reading_habits?: string[]; books_enjoyed_previously?: string[] }>('/api/preferences')
      .then((preferences) => {
        if (preferences.favourite_genres) setSelectedGenres(preferences.favourite_genres)
        setPreferenceDetails({
          favourite_authors: preferences.favourite_authors ?? [],
          reading_categories: preferences.reading_categories ?? [],
          reading_habits: preferences.reading_habits ?? [],
          books_enjoyed_previously: preferences.books_enjoyed_previously ?? [],
        })
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Could not load your reading preferences.')
      })
  }, [setSelectedGenres])

  const saveSettings = async () => {
    setError('')
    setSaved(false)
    try {
      await apiRequest('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          favourite_genres: selectedGenres,
          ...preferenceDetails,
        }),
      })
      setSaved(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save your settings.')
    }
  }

  return (
    <AppShell pageTitle="Profile & Settings" subtitle="My profile" onLogout={onLogout}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
          <div className="mb-5 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#28634C] to-[#79B092] text-lg font-semibold text-white">{user?.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() ?? 'SS'}</div>
            <div>
              <h3 className="text-xl font-semibold text-[#20352B]">{user?.full_name ?? 'Shelf Scan reader'}</h3>
              <p className="text-sm text-[#597162]">{user?.email}</p>
            </div>
          </div>

          <div className="space-y-4 text-sm text-[#20352B]">
            <div className="flex items-center justify-between rounded-2xl border border-[#dfe5e0] bg-white/50 px-4 py-3">
              <span>Theme</span>
              <span className="font-medium text-[#597162]">Soft green</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-[#dfe5e0] bg-white/50 px-4 py-3">
              <span>Password</span>
              <span className="font-medium text-[#597162]">Updated 2 weeks ago</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-[#dfe5e0] bg-white/50 px-4 py-3">
              <span>Notification preferences</span>
              <span className="font-medium text-[#597162]">Enabled</span>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
          <h3 className="text-xl font-semibold text-[#20352B]">Reading interests</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {genreChips.map((genre) => (
              <button key={genre} type="button" onClick={() => setSelectedGenres((current) => current.includes(genre) ? current.filter((value) => value !== genre) : [...current, genre])} className={`rounded-full border px-3 py-2 text-sm ${selectedGenres.includes(genre) ? 'border-[#28634C] bg-[#28634C] text-white' : 'border-[#dfe5e0] bg-white/60 text-[#20352B]'}`}>
                {genre}
              </button>
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <GlassButton onClick={() => void saveSettings()}>Save changes</GlassButton>
            <button onClick={() => navigate('/forgot-password')} className="rounded-full border border-[#dfe5e0] bg-white/60 px-4 py-3 text-sm font-semibold text-[#20352B]">
              Change password
            </button>
          </div>
          {saved && <p role="status" className="mt-4 text-sm text-[#28634C]">Your preferences have been saved.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
        </div>
      </div>
    </AppShell>
  )
}

function HistoryPage({ onLogout }: { onLogout: () => void }) {
  const [scans, setScans] = useState<Array<{ id: string; name: string; created_at: string; books: Array<{ title: string; author: string }> }>>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    void apiRequest<Array<{ id: string; name: string; created_at: string; books: Array<{ title: string; author: string }> }>>('/api/scanner/history')
      .then((response) => {
        if (active) setScans(response)
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load scan history.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <AppShell pageTitle="Scan History" subtitle="Activity" onLogout={onLogout}>
      <div className="rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
        <PageIntro eyebrow="Your activity" title="Recent bookshelf scans" description="Review books recognized from your uploaded shelves." />
        {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {isLoading && <p className="rounded-xl bg-white/50 p-4 text-sm text-[#597162]">Loading scan history…</p>}
        <div className="space-y-2">
          {scans.map((scan) => (
            <div key={scan.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/60 bg-white/50 p-3">
              <div>
                <h3 className="text-sm font-semibold text-[#20352B]">{scan.name}</h3>
                <p className="mt-1 text-[11px] text-[#597162]">{new Date(scan.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-[#edf5ef] px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-[#28634C]">
                <Eye className="h-4 w-4" />
                {scan.books.length} books
              </div>
            </div>
          ))}
        </div>
        {!isLoading && scans.length === 0 && !error && <p className="rounded-2xl border border-dashed border-[#cfe1d5] bg-white/45 p-6 text-center text-sm text-[#597162]">Your completed bookshelf scans will appear here.</p>}
      </div>
    </AppShell>
  )
}

function FavouritesPage({ onLogout, favoriteIds, toggleFavorite, addToCart }: { onLogout: () => void; favoriteIds: string[]; toggleFavorite: (bookId: string) => void; addToCart: (bookId: string) => Promise<boolean> }) {
  const [favourites, setFavourites] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void apiRequest<ApiBook[]>('/api/favourites')
      .then((response) => {
        if (active) setFavourites(response.map(mapApiBook))
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load your wishlist.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [favoriteIds])

  const moveToCart = async (bookId: string) => {
    if (await addToCart(bookId)) toggleFavorite(bookId)
  }

  return (
    <AppShell pageTitle="Favourites" subtitle="Saved picks" onLogout={onLogout}>
      {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {loading && <SectionCard><p className="text-sm text-[#597162]">Loading your wishlist…</p></SectionCard>}
      {!loading && favourites.length === 0 && !error && <SectionCard className="text-center"><Heart className="mx-auto h-8 w-8 text-[#4c8664]" /><h3 className="mt-3 font-semibold text-[#20352B]">Your favourite shelf is ready</h3><p className="mt-1 text-sm text-[#597162]">Tap the heart on any book to save it here.</p></SectionCard>}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {favourites.map((book) => (
          <div key={book.id} className="overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-3">
            <img src={book.cover} alt={book.title} className="h-56 w-full rounded-[20px] object-cover" />
            <div className="mt-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#718477]">{book.genre}</p>
              <h4 className="mt-2 text-xl font-semibold text-[#20352B]">{book.title}</h4>
              <p className="mt-1 text-sm text-[#597162]">by {book.author}</p>
              <p className="mt-2 text-xs text-[#28634C]">{book.priceAmount != null && book.priceCurrency ? `${book.priceCurrency} ${book.priceAmount.toFixed(2)} · ${book.retailerName}` : 'Verified price unavailable'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void moveToCart(book.id)} className="rounded-full bg-[#28634C] px-3 py-1.5 text-xs font-semibold text-white">Move to cart</button>
                <button type="button" onClick={() => toggleFavorite(book.id)} className="rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-1.5 text-xs font-semibold text-[#28634C]">Remove from wishlist</button>
                {book.retailerUrl && <a href={book.retailerUrl} target="_blank" rel="noreferrer" className="rounded-full border border-[#dfe5e0] bg-white/75 px-3 py-1.5 text-xs font-semibold text-[#28634C]">Buy now <ArrowUpRight className="ml-1 inline h-3 w-3" /></a>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  )
}

function BookDetailsPage({ onLogout, favoriteIds, toggleFavorite, addToLibrary, addToCart }: { onLogout: () => void; favoriteIds: string[]; toggleFavorite: (bookId: string) => void; addToLibrary: (bookId: string) => void; addToCart: (bookId: string) => void }) {
  const { id } = useParams()
  const [loadedBook, setLoadedBook] = useState<Book | null>(null)
  const [loadedForId, setLoadedForId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const loading = loadedForId !== (id ?? '')
  const currentBook = loading ? null : loadedBook

  useEffect(() => {
    let active = true
    void apiRequest<ApiBook>(`/api/books/${encodeURIComponent(id ?? '')}`)
      .then((response) => {
        if (active) {
          setLoadedBook(mapApiBook(response))
          setError('')
          setLoadedForId(id ?? '')
        }
      })
      .catch((requestError: unknown) => {
        if (!active) return
        setLoadedBook(null)
        setError(requestError instanceof Error ? requestError.message : 'Could not load this book.')
        setLoadedForId(id ?? '')
      })
    return () => {
      active = false
    }
  }, [id])

  if (!currentBook) {
    return <AppShell pageTitle="Book Details" subtitle="Book information" onLogout={onLogout}>
      <SectionCard>
        {loading ? <p className="text-sm text-[#597162]">Loading book details…</p> : <p role="alert" className="text-sm text-rose-700">{error || 'Book details are unavailable.'}</p>}
      </SectionCard>
    </AppShell>
  }
  const book = currentBook
  return (
    <AppShell pageTitle={book.title} subtitle="Book details" onLogout={onLogout}>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
          <img src={book.cover} alt={book.title} className="h-[430px] w-full rounded-[28px] object-cover" />
        </div>

        <div className="space-y-5 rounded-[30px] border border-white/50 bg-white/30 p-5 shadow-[0_20px_50px_rgba(32,53,43,0.08)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[#718477]">{book.genre}</p>
              <h3 className="mt-2 text-3xl font-semibold text-[#20352B]">{book.title}</h3>
              <p className="mt-2 text-lg text-[#597162]">by {book.author}</p>
            </div>
            <button onClick={() => toggleFavorite(book.id)} className={`rounded-full p-3 ${favoriteIds.includes(book.id) ? 'bg-rose-100 text-rose-600' : 'bg-[#f3f8f4] text-[#20352B]'}`}>
              <Heart className={`h-5 w-5 ${favoriteIds.includes(book.id) ? 'fill-current' : ''}`} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {book.publisher && <span className="rounded-full border border-[#dfe5e0] bg-white/60 px-3 py-2 text-sm text-[#20352B]">{book.publisher}</span>}
            {book.publicationYear > 0 && <span className="rounded-full border border-[#dfe5e0] bg-white/60 px-3 py-2 text-sm text-[#20352B]">{book.publicationYear}</span>}
            <span className="rounded-full border border-[#dfe5e0] bg-white/60 px-3 py-2 text-sm text-[#20352B]">AI compatibility {book.compatibility}%</span>
            {book.isbn && <span className="rounded-full border border-[#dfe5e0] bg-white/60 px-3 py-2 text-sm text-[#20352B]">ISBN {book.isbn}</span>}
            {book.averageRating !== null && book.averageRating !== undefined && <span className="rounded-full border border-[#dfe5e0] bg-white/60 px-3 py-2 text-sm text-[#20352B]">Rating {book.averageRating}{book.ratingsCount ? ` (${book.ratingsCount})` : ''}</span>}
          </div>

          <p className="text-base leading-7 text-[#597162]">{book.description}</p>
          {book.editions && book.editions.length > 0 && <div className="rounded-[20px] border border-white/50 bg-white/45 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#718477]">Available edition information</p><div className="mt-2 space-y-1 text-xs text-[#597162]">{book.editions.map((edition, index) => <p key={`${book.id}-edition-${index}`}>{[edition.format, edition.page_count ? `${edition.page_count} pages` : '', edition.language, edition.key].filter(Boolean).join(' · ') || 'Edition listed by catalogue provider'}</p>)}</div></div>}

          <div className="rounded-[24px] border border-white/40 bg-gradient-to-r from-[#edf7ef] to-[#f5faf6] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#718477]">Why you might like this</p>
            <p className="mt-2 text-base text-[#20352B]">{book.recommendation}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <GlassButton onClick={() => addToLibrary(book.id)}>Save to library</GlassButton>
            <button type="button" onClick={() => addToCart(book.id)} className="rounded-full border border-[#dfe5e0] bg-white/70 px-4 py-3 text-sm font-semibold text-[#20352B]">Add to cart</button>
            <button type="button" onClick={() => toggleFavorite(book.id)} className="rounded-full border border-[#dfe5e0] bg-white/70 px-4 py-3 text-sm font-semibold text-[#20352B]">{favoriteIds.includes(book.id) ? 'Remove from wishlist' : 'Add to wishlist'}</button>
            {book.retailerUrl ? <a href={book.retailerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[#28634C] px-4 py-3 text-sm font-semibold text-white">Buy now{book.priceAmount !== null && book.priceAmount !== undefined && book.priceCurrency ? ` · ${book.priceCurrency} ${book.priceAmount.toFixed(2)}` : ''}<ArrowUpRight className="h-4 w-4" /></a> : <p className="w-full text-xs text-[#718477]">No verified retailer purchase link or current price is available for this book.</p>}
          </div>
          <p className="text-[10px] text-[#718477]">External retailer purchases are not in-app Shelf Scan orders.</p>
        </div>
      </div>
    </AppShell>
  )
}

export default App
