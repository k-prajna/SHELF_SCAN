export type Book = {
  id: string
  title: string
  author: string
  genre: string
  description: string
  cover: string
  publisher: string
  publicationYear: number
  matchScore: number
  compatibility: number
  recommendation: string
  aiExplanation: string
  isbn?: string | null
  averageRating?: number | null
  ratingsCount?: number | null
  editions?: Array<Record<string, unknown>>
  retailerName?: string | null
  retailerUrl?: string | null
  priceAmount?: number | null
  priceCurrency?: string | null
  priceUpdatedAt?: string | null
  metadataSource?: string
  status?: 'BUY IT' | 'SAVE IT' | 'SKIP IT'
}

export const userProfile = {
  id: 'u_1',
  name: 'Maya Reed',
  email: 'maya@bookshelf.app',
  favouriteGenres: ['Mystery', 'Psychological Thriller', 'Fantasy'],
}

export const books: Book[] = [
  {
    id: 'b_1',
    title: 'The Silent Patient',
    author: 'Alex Michaelides',
    genre: 'Psychological Thriller',
    description:
      'A psychological thriller about a woman who stops speaking after a violent act.',
    cover:
      'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=800&q=80',
    publisher: 'Celadon Books',
    publicationYear: 2019,
    matchScore: 96,
    compatibility: 96,
    recommendation:
      'You enjoy tense, character-driven thrillers with a sharp psychological edge.',
    aiExplanation: 'Strong alignment with your recent mystery and suspense preferences.',
    status: 'BUY IT',
  },
  {
    id: 'b_2',
    title: 'Leave No Trace',
    author: 'M. M. DeWitt',
    genre: 'Mystery',
    description:
      'A haunting mystery filled with layered secrets and environmental tension.',
    cover:
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=800&q=80',
    publisher: 'Little, Brown',
    publicationYear: 2021,
    matchScore: 92,
    compatibility: 92,
    recommendation:
      'This matches the slow-burn suspense and atmospheric mood you gravitate toward.',
    aiExplanation: 'The pacing and atmospheric nuance fit your preferred reading rhythm.',
    status: 'SAVE IT',
  },
  {
    id: 'b_3',
    title: 'The Midnight Library',
    author: 'Matt Haig',
    genre: 'Fantasy',
    description:
      'A reflective fantasy that blends life choices with emotional resonance and wonder.',
    cover:
      'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=800&q=80',
    publisher: 'Viking',
    publicationYear: 2020,
    matchScore: 88,
    compatibility: 88,
    recommendation:
      'You like emotionally rich narratives with speculative elements and a human core.',
    aiExplanation: 'An uplifting but thoughtful match for your current reading personality.',
    status: 'BUY IT',
  },
  {
    id: 'b_4',
    title: 'The Thursday Murder Club',
    author: 'Richard Osman',
    genre: 'Cozy Mystery',
    description:
      'A witty and warm mystery featuring a retirement village sleuthing circle.',
    cover:
      'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=800&q=80',
    publisher: 'Pamela Dorman',
    publicationYear: 2020,
    matchScore: 84,
    compatibility: 84,
    recommendation:
      'A light but cleverly plotted mystery with a strong community atmosphere.',
    aiExplanation: 'A strong fit if you want something intelligent, accessible, and comforting.',
    status: 'SKIP IT',
  },
  {
    id: 'b_5',
    title: 'The House in the Cerulean Sea',
    author: 'TJ Klune',
    genre: 'Fantasy',
    description:
      'A cozy magical adventure about found family and self-discovery.',
    cover:
      'https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=800&q=80',
    publisher: 'Tor',
    publicationYear: 2020,
    matchScore: 81,
    compatibility: 81,
    recommendation:
      'Warm and uplifting without losing the emotional depth you enjoy.',
    aiExplanation: 'A good balance of comfort and character-driven depth.',
    status: 'SAVE IT',
  },
]

export const recentScans = [
  {
    id: 'scan_1',
    title: 'Living Room Shelf',
    date: 'Today, 7:20 PM',
    books: ['b_1', 'b_2', 'b_4'],
  },
  {
    id: 'scan_2',
    title: 'Nightstand Stack',
    date: 'Yesterday',
    books: ['b_3', 'b_5'],
  },
]

export const readingStats = [
  { label: 'Books this year', value: '24', accent: 'emerald' },
  { label: 'Avg. match score', value: '89%', accent: 'mint' },
  { label: 'Saved for later', value: '14', accent: 'sage' },
]

export const genreChips = [
  'Mystery',
  'Psychological Thriller',
  'Fantasy',
  'Literary Fiction',
  'History',
  'Sci-Fi',
  'Memoir',
  'Classic',
]

export const libraryBooks = [
  { id: 'b_1', shelf: 'Currently Reading' },
  { id: 'b_3', shelf: 'Favourites' },
  { id: 'b_5', shelf: 'Want to Read' },
]

export const topRecommendations = [
  {
    bookId: 'b_1',
    category: 'BUY IT',
    score: 96,
    reason: 'Strong overlap with your mystery-centered mood.',
  },
  {
    bookId: 'b_2',
    category: 'SAVE IT',
    score: 92,
    reason: 'Atmospheric suspense fits your shelf personality.',
  },
  {
    bookId: 'b_4',
    category: 'SKIP IT',
    score: 45,
    reason: 'More playful than your usual thrillers.',
  },
]
