import React, { useState, useEffect, Component, ReactNode, useRef } from 'react';
import { Brain, CheckCircle2, XCircle, RotateCcw, Loader2, BarChart3, Home, Sparkles, Settings, Calendar, TrendingUp, ArrowRight, ChevronDown, ChevronUp, Clock, Bookmark, BookmarkCheck } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYLLABUS: Record<string, Record<string, string[]>> = {
  "Mathematics": {
    "Number System": ["Computation of Whole Number", "Decimal and Fractions", "Relationship between numbers"],
    "Fundamental Arithmetical Operations": ["Percentages", "Ratio and Proportion", "Square roots", "Averages", "Simple and Compound Interest", "Profit and Loss", "Discount", "Partnership Business", "Mixture and Allegation", "Time and distance", "Time and work"],
    "Algebra": ["Basic algebraic identities", "Polynomials", "Linear Equations"],
    "Geometry": ["Elementary geometric figures", "Triangle centres", "Congruence and similarity", "Circles, chords, tangents"],
    "Mensuration": ["Triangle", "Quadrilaterals", "Regular Polygons", "Circle", "Right Prism", "Right Circular Cone", "Right Circular Cylinder", "Sphere", "Hemispheres", "Rectangular Parallelepiped", "Regular Right Pyramid"],
    "Trigonometry": ["Trigonometric ratios", "Complementary angles", "Height and distances", "Standard Identities"],
    "Statistical Charts": ["Use of Tables and Graphs", "Histogram", "Polygon", "Bar-diagram", "Pie-chart"]
  },
  "Reasoning": {
    "Verbal Reasoning": ["Semantic Analogy", "Symbolic operations", "Symbolic/Number Analogy", "Trends", "Figural Analogy", "Space Orientation", "Semantic Classification", "Venn Diagrams", "Symbolic/Number Classification", "Drawing inferences"],
    "Non-Verbal Reasoning": ["Figural Classification", "Punched hole/pattern-folding", "Semantic Series", "Figural Pattern-folding", "Number Series", "Embedded figures", "Figural Series", "Critical Thinking", "Problem Solving", "Word Building", "Coding and de-coding"]
  },
  "General Studies": {
    "History": ["Ancient History", "Medieval History", "Modern History", "Art and Culture"],
    "Geography": ["Indian Geography", "World Geography", "Physical Geography"],
    "Polity": ["Constitution of India", "Government Structure", "Panchayati Raj", "Important Amendments"],
    "Economics": ["Microeconomics", "Macroeconomics", "Indian Economy", "Five Year Plans"],
    "General Science": ["Physics", "Chemistry", "Biology", "Space & Technology", "Environmental Science"],
    "Current Affairs": ["National News", "International News", "Sports", "Awards and Honours", "Books and Authors"]
  },
  "English": {
    "Vocabulary": ["Synonyms", "Antonyms", "Spelling/Detecting mis-spelt words", "Idioms & Phrases", "One word substitution"],
    "Grammar": ["Spot the Error", "Fill in the Blanks", "Improvement of Sentences", "Active/Passive Voice", "Direct/Indirect Narration"],
    "Comprehension": ["Shuffling of Sentence parts", "Shuffling of Sentences in a passage", "Cloze Passage", "Comprehension Passage"]
  }
};

type SubtopicStats = {
  total: number;
  correct: number;
  lastReviewed: number;
  nextReview: number;
  interval: number;
  easeFactor: number;
  subject: string;
  topic: string;
  name?: string;
};

type GlobalProgress = Record<string, SubtopicStats>;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  state = { hasError: false, error: null };
  
  constructor(props: {children: ReactNode}) {
    super(props);
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Something went wrong</h2>
            <p className="text-slate-600 mb-4">We encountered an error while loading your data.</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium">Reload App</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [step, setStep] = useState('select'); 
  
  // Settings
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [negativeMarking, setNegativeMarking] = useState(true);

  // Selection States
  const [selectedSubject, setSelectedSubject] = useState('Mathematics');
  const [selectedTopic, setSelectedTopic] = useState('Number System');
  const [selectedSubtopic, setSelectedSubtopic] = useState('All');

  // Quiz States
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<any[]>([]);
  const [activeQuestions, setActiveQuestions] = useState<any[]>([]);
  const [activeSubtopics, setActiveSubtopics] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Progress State
  const [globalProgress, setGlobalProgress] = useState<GlobalProgress>({});
  const [sessionProgress, setSessionProgress] = useState<Record<string, {total: number, correct: number}>>({});

  const [showReview, setShowReview] = useState(false);

  // Aspirant Features
  const [quizStartTime, setQuizStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    isTransitioningRef.current = false;
  }, [currentIndex, step]);

  useEffect(() => {
    if (step === 'select' && !SYLLABUS[selectedSubject]) {
      const firstSubject = Object.keys(SYLLABUS)[0];
      setSelectedSubject(firstSubject);
      setSelectedTopic(Object.keys(SYLLABUS[firstSubject] || {})[0] || '');
      setSelectedSubtopic('All');
    }
  }, [step, selectedSubject]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === 'quiz') {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - quizStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, quizStartTime]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const toggleBookmark = async (question: any) => {
    if (!user) return;
    
    const isBookmarked = bookmarks.some(b => b.text === question.text);
    let newBookmarks;
    if (isBookmarked) {
      newBookmarks = bookmarks.filter(b => b.text !== question.text);
    } else {
      newBookmarks = [...bookmarks, { ...question, savedAt: Date.now() }];
    }
    
    setBookmarks(newBookmarks);

    try {
      await setDoc(doc(db, 'users', user.uid, 'data', 'bookmarks'), { items: newBookmarks }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/data/bookmarks`);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Auth error:", err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
      try {
        const progressRef = doc(db, 'users', user.uid, 'data', 'progress');
        const progressSnap = await getDoc(progressRef);
        if (progressSnap.exists()) {
          setGlobalProgress(progressSnap.data() as GlobalProgress);
        }

        const settingsRef = doc(db, 'users', user.uid, 'data', 'settings');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          if (settingsSnap.data().difficulty) setDifficulty(settingsSnap.data().difficulty);
          if (settingsSnap.data().negativeMarking !== undefined) setNegativeMarking(settingsSnap.data().negativeMarking);
        }

        const bookmarksRef = doc(db, 'users', user.uid, 'data', 'bookmarks');
        const bookmarksSnap = await getDoc(bookmarksRef);
        if (bookmarksSnap.exists() && bookmarksSnap.data().items) {
          setBookmarks(bookmarksSnap.data().items);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/data`);
      }
    };
    loadData();
  }, [user]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-100 p-4 rounded-full">
              <Brain className="w-12 h-12 text-indigo-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-2">NeuroSpaced</h1>
          <p className="text-slate-500 mb-8">AI-powered spaced repetition learning.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all active:scale-[0.98] shadow-md flex justify-center items-center gap-2"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const saveDifficulty = async (newDiff: 'Easy' | 'Medium' | 'Hard') => {
    setDifficulty(newDiff);
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'data', 'settings'), { difficulty: newDiff }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/data/settings`);
      }
    }
  };

  const saveNegativeMarking = async (enabled: boolean) => {
    setNegativeMarking(enabled);
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'data', 'settings'), { negativeMarking: enabled }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/data/settings`);
      }
    }
  };

  const handleSubjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const subject = e.target.value;
    setSelectedSubject(subject);
    const firstTopic = Object.keys(SYLLABUS[subject] || {})[0];
    setSelectedTopic(firstTopic || '');
    setSelectedSubtopic('All');
  };

  const handleTopicChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTopic(e.target.value);
    setSelectedSubtopic('All');
  };

  const startBookmarkReview = () => {
    if (bookmarks.length === 0) return;
    const questionsToReview = [...bookmarks].sort(() => 0.5 - Math.random()).slice(0, 10);
    const uniqueSubtopics = Array.from(new Set(questionsToReview.map(q => q.subtopic)));
    setSelectedSubject('Mixed Subjects');
    setSelectedTopic('Bookmark Review');
    setActiveSubtopics(uniqueSubtopics);
    setActiveQuestions(questionsToReview);
    setStep('quiz');
    setCurrentIndex(0);
    setAnswers([]);
    setSelectedAnswer(null);
    setShowReview(false);
    setQuizStartTime(Date.now());
    setElapsedTime(0);
  };

  const handleSmartPractice = () => {
    let targetSubject = 'Mathematics';
    let targetTopic = 'Number System';

    const progressEntries = Object.values(globalProgress);
    if (progressEntries.length > 0) {
      // Find the topic with the lowest accuracy or due for review
      const now = Date.now();
      let weakest = progressEntries[0];
      let lowestScore = Infinity;

      progressEntries.forEach(stats => {
        const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
        const isDue = stats.nextReview < now;
        // Score: lower is worse. Due topics get a massive penalty to prioritize them.
        const score = accuracy - (isDue ? 10 : 0);
        
        if (score < lowestScore && stats.subject && stats.topic) {
          lowestScore = score;
          weakest = stats;
        }
      });

      if (weakest.subject && weakest.topic) {
        targetSubject = weakest.subject;
        targetTopic = weakest.topic;
      }
    } else {
      // Randomly pick if no history
      const subjects = Object.keys(SYLLABUS);
      targetSubject = subjects[Math.floor(Math.random() * subjects.length)];
      const topics = Object.keys(SYLLABUS[targetSubject]);
      targetTopic = topics[Math.floor(Math.random() * topics.length)];
    }

    setSelectedSubject(targetSubject);
    setSelectedTopic(targetTopic);
    setSelectedSubtopic('All');
    
    // We need to use setTimeout to allow state to update before fetching
    setTimeout(() => {
      fetchQuestionsFromAI(false, false, targetSubject, targetTopic);
    }, 0);
  };

  const fetchQuestionsFromAI = async (isReviewCycle = false, isMixedReview = false, overrideSubject?: string, overrideTopic?: string) => {
    const currentSubject = overrideSubject || selectedSubject;
    const currentTopic = overrideTopic || selectedTopic;
    
    if (!isMixedReview && !currentTopic) return;
    setIsGenerating(true);
    setErrorMsg('');
    
    try {
      const now = Date.now();
      const historyContext = (Object.entries(globalProgress) as [string, SubtopicStats][]).map(([st, stats]) => {
        const isDue = stats.nextReview < now;
        const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
        return `${stats.name || st} (Subject: ${stats.subject}, Topic: ${stats.topic}): ${accuracy}% accuracy, ${isDue ? 'DUE FOR REVIEW' : 'Not due'}`;
      }).join('\n');

      const targetSubject = isMixedReview ? 'Mixed Subjects' : currentSubject;
      const targetTopic = isMixedReview ? 'Mixed Review of Due Topics' : currentTopic;
      const targetSubtopic = isMixedReview ? 'Mixed' : selectedSubtopic;

      if (isMixedReview) {
        setSelectedSubject(targetSubject);
        setSelectedTopic(targetTopic);
      }

      const prompt = `
        You are an expert quiz generator.
        Target Subject: ${targetSubject}
        Target Topic: ${targetTopic}
        ${targetSubtopic !== 'All' ? `Target Subtopic: ${targetSubtopic}` : ''}
        Difficulty: ${difficulty} (Adjust complexity of questions and obscurity of topics accordingly. Easy = fundamental, Medium = applied, Hard = edge cases/complex).
        
        User's Global History & Spaced Repetition Data:
        ${historyContext || 'No history yet.'}
        
        Task 1: Identify 3 to 5 specific subtopics. 
        - If the user provided a specific Target Subtopic, use that as the primary focus or break it down into narrower aspects.
        - If this is a Mixed Review or Review Cycle, PRIORITIZE subtopics from the history that are "DUE FOR REVIEW" or have < 70% accuracy.
        - Reuse exact existing subtopic names from history if they match your intended subtopics to maintain tracking.
        
        Task 2: Generate 10 multiple-choice questions across these subtopics at the requested difficulty.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subtopics: { type: Type.ARRAY, items: { type: Type.STRING } },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    subtopic: { type: Type.STRING },
                    text: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    answer: { type: Type.STRING },
                    explanation: { type: Type.STRING, description: "A brief explanation of why the answer is correct." }
                  },
                  required: ["subtopic", "text", "options", "answer", "explanation"]
                }
              }
            },
            required: ["subtopics", "questions"]
          }
        }
      });

      let rawText = response.text || "{}";
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(rawText);
      
      if (!result.subtopics || !result.questions) {
        throw new Error("Invalid response format");
      }

      const questionsWithContext = result.questions.map((q: any) => ({
        ...q,
        subject: targetSubject,
        topic: targetTopic
      }));

      setActiveSubtopics(result.subtopics);
      setActiveQuestions(questionsWithContext);
      setStep('quiz');
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedAnswer(null);
      setShowReview(false);
      setQuizStartTime(Date.now());
      setElapsedTime(0);
    } catch (error) {
      console.error("Failed to generate:", error);
      setErrorMsg("AI hit a snag processing that topic. Try again!");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswer = (selectedOption: string) => {
    if (selectedAnswer) return;
    setSelectedAnswer(selectedOption);
  };

  const handleNextQuestion = () => {
    if (!selectedAnswer || answers.length > currentIndex || isTransitioningRef.current) return;
    isTransitioningRef.current = true;

    const currentQ = activeQuestions[currentIndex];
    const isCorrect = selectedAnswer === currentQ.answer;
    
    const newAnswers = [...answers, { ...currentQ, isCorrect, userAnswer: selectedAnswer }];
    setAnswers(newAnswers);
    
    if (currentIndex < activeQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer(null);
    } else {
      analyzeResults(newAnswers);
    }
  };

  const sanitizeKey = (key: string) => key.replace(/[\.\/\[\]~]/g, '_');

  const analyzeResults = async (finalAnswers: any[]) => {
    const newSessionProgress: Record<string, {total: number, correct: number, subject: string, topic: string}> = {};
    const updatedGlobalProgress = { ...globalProgress };
    const now = Date.now();
    
    activeSubtopics.forEach(st => newSessionProgress[st] = { total: 0, correct: 0, subject: selectedSubject, topic: selectedTopic || 'Mixed Review' });

    finalAnswers.forEach(ans => {
      if (!newSessionProgress[ans.subtopic]) newSessionProgress[ans.subtopic] = { total: 0, correct: 0, subject: ans.subject || selectedSubject, topic: ans.topic || selectedTopic || 'Mixed Review' };
      newSessionProgress[ans.subtopic].total += 1;
      if (ans.isCorrect) newSessionProgress[ans.subtopic].correct += 1;
      // Ensure we capture the specific subject/topic from the question if it exists
      if (ans.subject && ans.topic) {
        newSessionProgress[ans.subtopic].subject = ans.subject;
        newSessionProgress[ans.subtopic].topic = ans.topic;
      }
    });

    // Apply Spaced Repetition (SM-2 simplified)
    Object.keys(newSessionProgress).forEach(st => {
      const sessionStats = newSessionProgress[st];
      if (sessionStats.total === 0) return;

      const quality = Math.round((sessionStats.correct / sessionStats.total) * 5); // 0 to 5
      
      const stKey = sanitizeKey(st);
      
      const existing = updatedGlobalProgress[stKey] ? { ...updatedGlobalProgress[stKey] } : {
        total: 0, correct: 0, lastReviewed: 0, nextReview: 0, interval: 0, easeFactor: 2.5, subject: sessionStats.subject, topic: sessionStats.topic, name: st
      };
      
      existing.total += sessionStats.total;
      existing.correct += sessionStats.correct;
      existing.lastReviewed = now;
      
      if (quality < 3) {
        existing.interval = 1;
      } else if (existing.interval === 0) {
        existing.interval = 1;
      } else if (existing.interval === 1) {
        existing.interval = 6;
      } else {
        existing.interval = Math.round(existing.interval * existing.easeFactor);
      }
      
      existing.easeFactor = Math.max(1.3, existing.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      existing.nextReview = now + existing.interval * 24 * 60 * 60 * 1000;
      
      updatedGlobalProgress[stKey] = existing;
    });

    setSessionProgress(newSessionProgress);
    setGlobalProgress(updatedGlobalProgress);
    setStep('analysis');

    if (user) {
      try {
        const docRef = doc(db, 'users', user.uid, 'data', 'progress');
        await setDoc(docRef, updatedGlobalProgress, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/data/progress`);
      }
    }
  };

  const getSubtopicColor = (correct: number, total: number) => {
    if (total === 0) return 'text-gray-500 bg-gray-100 border-gray-200';
    const ratio = correct / total;
    if (ratio >= 0.8) return 'text-green-700 bg-green-100 border-green-300';
    if (ratio >= 0.5) return 'text-yellow-700 bg-yellow-100 border-yellow-300';
    return 'text-red-700 bg-red-100 border-red-300';
  };

  const dueCount = (Object.values(globalProgress) as SubtopicStats[]).filter(st => st.nextReview < Date.now()).length;

  const groupedProgress = (Object.entries(globalProgress) as [string, SubtopicStats][]).reduce((acc, [subtopic, data]) => {
    if (!acc[data.subject]) acc[data.subject] = {};
    if (!acc[data.subject][data.topic]) acc[data.subject][data.topic] = {};
    acc[data.subject][data.topic][subtopic] = data;
    return acc;
  }, {} as Record<string, Record<string, Record<string, SubtopicStats>>>);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8 flex justify-center items-start pt-12">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
        
        {/* Header */}
        <div className="bg-indigo-600 p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8" />
            <h1 className="text-2xl font-bold tracking-tight">NeuroSpaced</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setStep(step === 'dashboard' ? 'select' : 'dashboard');
              }}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-full transition-colors active:scale-95"
            >
              {step === 'dashboard' ? <Home className="w-5 h-5" /> : <BarChart3 className="w-5 h-5" />}
            </button>
            <button onClick={handleLogout} className="text-sm font-medium hover:text-indigo-200 transition-colors">
              Sign Out
            </button>
          </div>
        </div>

        <div className="p-6 md:p-8">
          
          {/* DASHBOARD / GLOBAL ANALYSIS */}
          {step === 'dashboard' && (
            <div className="animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div>
                  <h2 className="text-2xl font-bold">Global Analysis</h2>
                  <p className="text-slate-500 mt-1">Your spaced repetition history</p>
                </div>
                <div className="flex gap-3">
                  {bookmarks.length > 0 && (
                    <button 
                      onClick={startBookmarkReview}
                      disabled={isGenerating}
                      className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded-xl font-bold transition-colors flex items-center gap-2"
                    >
                      <Bookmark className="w-4 h-4" />
                      Review Bookmarks
                    </button>
                  )}
                  {dueCount > 0 && (
                    <button 
                      onClick={() => fetchQuestionsFromAI(true, true)}
                      disabled={isGenerating}
                      className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-4 py-2 rounded-xl font-bold transition-colors flex items-center gap-2"
                    >
                      {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                      Review {dueCount} Due
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-1">Saved</p>
                    <p className="text-2xl font-bold text-indigo-700">{bookmarks.length} Bookmarks</p>
                  </div>
                  <div className="bg-indigo-200 p-3 rounded-full text-indigo-600">
                    <Bookmark className="w-6 h-6" />
                  </div>
                </div>
                <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-orange-400 uppercase tracking-wider mb-1">Due</p>
                    <p className="text-2xl font-bold text-orange-700">{dueCount} Reviews</p>
                  </div>
                  <div className="bg-orange-200 p-3 rounded-full text-orange-600">
                    <Calendar className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {Object.keys(globalProgress).length === 0 ? (
                <p className="text-slate-500 text-center py-8">No data yet. Go learn something!</p>
              ) : (
                <div className="space-y-8">
                  {Object.entries(groupedProgress).map(([subject, topics]) => (
                    <div key={subject} className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                      <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-indigo-500" />
                        {subject}
                      </h3>
                      <div className="space-y-6">
                        {Object.entries(topics).map(([topic, subtopics]) => (
                          <div key={topic} className="pl-4 border-l-2 border-indigo-200">
                            <h4 className="text-lg font-semibold text-slate-700 mb-3">{topic}</h4>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {Object.entries(subtopics).map(([subtopic, data]) => {
                                const percentage = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0;
                                const barColor = percentage >= 80 ? 'bg-green-500' : percentage >= 50 ? 'bg-yellow-500' : 'bg-red-500';
                                const isDue = data.nextReview < Date.now();
                                return (
                                  <div key={subtopic} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="flex justify-between items-start mb-2">
                                       <div className="flex flex-col gap-1">
                                         <span className="font-semibold text-slate-700 leading-tight">{data.name || subtopic}</span>
                                         {isDue && <span className="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1 w-fit"><Calendar className="w-3 h-3"/> Due</span>}
                                       </div>
                                       <span className="text-sm font-bold">{percentage}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                                      <div className={`h-2 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${percentage}%` }}></div>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <p className="text-[10px] text-slate-400">Next: {new Date(data.nextReview).toLocaleDateString()}</p>
                                      <p className="text-[10px] text-slate-400 font-medium">{data.correct}/{data.total}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SELECTOR */}
          {step === 'select' && (
            <div className="animate-in fade-in">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">What are we studying today?</h2>
                {dueCount > 0 && (
                  <button 
                    onClick={() => fetchQuestionsFromAI(true, true)}
                    disabled={isGenerating}
                    className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors flex items-center gap-1.5"
                  >
                    {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calendar className="w-3 h-3" />}
                    {dueCount} Due
                  </button>
                )}
              </div>
              
              <div className="space-y-6 mb-8">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">Subject</label>
                  <select 
                    value={selectedSubject} 
                    onChange={handleSubjectChange}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all font-medium text-slate-700"
                  >
                    {Object.keys(SYLLABUS).map(subject => (
                      <option key={subject} value={subject}>{subject}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">Topic</label>
                  <select 
                    value={selectedTopic} 
                    onChange={handleTopicChange}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all font-medium text-slate-700"
                  >
                    {Object.keys(SYLLABUS[selectedSubject] || {}).map(topic => (
                      <option key={topic} value={topic}>{topic}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">Subtopic (Optional)</label>
                  <select 
                    value={selectedSubtopic} 
                    onChange={(e) => setSelectedSubtopic(e.target.value)}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all font-medium text-slate-700"
                  >
                    <option value="All">All Subtopics (AI Generated)</option>
                    {SYLLABUS[selectedSubject]?.[selectedTopic]?.map(subtopic => (
                      <option key={subtopic} value={subtopic}>{subtopic}</option>
                    ))}
                  </select>
                  {errorMsg ? (
                    <p className="text-sm text-red-500 mt-2 font-medium">{errorMsg}</p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> AI will automatically generate questions based on your selection.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2 flex items-center gap-2">
                    <Settings className="w-4 h-4" /> Difficulty Level
                  </label>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {['Easy', 'Medium', 'Hard'].map((level) => (
                      <button
                        key={level}
                        onClick={() => saveDifficulty(level as any)}
                        className={`py-3 rounded-xl font-bold transition-all border-2 ${
                          difficulty === level 
                            ? 'bg-indigo-50 border-indigo-500 text-indigo-700' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 p-4 rounded-xl">
                    <div>
                      <p className="font-bold text-slate-700">Negative Marking</p>
                      <p className="text-xs text-slate-500 mt-0.5">Simulate real exam scoring (+4 correct, -1 incorrect)</p>
                    </div>
                    <button
                      onClick={() => saveNegativeMarking(!negativeMarking)}
                      className={`w-12 h-6 rounded-full transition-colors relative ${negativeMarking ? 'bg-indigo-500' : 'bg-slate-300'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${negativeMarking ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <button 
                  onClick={handleSmartPractice}
                  disabled={isGenerating}
                  className="w-full sm:w-1/2 py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl font-bold transition-all active:scale-[0.98] shadow-md hover:shadow-lg disabled:shadow-none flex justify-center items-center gap-2"
                >
                  {isGenerating ? <><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</> : <><Sparkles className="w-5 h-5" /> Smart Practice</>}
                </button>
                <button 
                  onClick={() => fetchQuestionsFromAI(false, false)}
                  disabled={!selectedTopic || isGenerating}
                  className="w-full sm:w-1/2 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-bold transition-all active:scale-[0.98] shadow-md hover:shadow-lg disabled:shadow-none flex justify-center items-center gap-2"
                >
                  {isGenerating ? <><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</> : "Start Custom Quiz"}
                </button>
              </div>
            </div>
          )}

          {/* QUIZ */}
          {step === 'quiz' && activeQuestions.length > 0 && (
            <div className="animate-in fade-in">
              <div className="flex justify-between text-sm font-medium text-slate-500 mb-6">
                <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full border border-indigo-100 shadow-sm">{activeQuestions[currentIndex].subtopic}</span>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 font-mono bg-slate-100 px-2 py-1 rounded-md text-slate-600"><Clock className="w-4 h-4" /> {formatTime(elapsedTime)}</span>
                  <span>{currentIndex + 1} / {activeQuestions.length}</span>
                </div>
              </div>
              
              <div className="flex justify-between items-start gap-4 mb-8">
                <h2 className="text-xl font-semibold leading-relaxed">
                  {activeQuestions[currentIndex].text}
                </h2>
                <button 
                  onClick={() => toggleBookmark(activeQuestions[currentIndex])}
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors shrink-0"
                  title="Bookmark Question"
                >
                  {bookmarks.some(b => b.text === activeQuestions[currentIndex].text) ? (
                    <BookmarkCheck className="w-6 h-6 text-indigo-600" />
                  ) : (
                    <Bookmark className="w-6 h-6" />
                  )}
                </button>
              </div>

              <div className="space-y-3">
                {activeQuestions[currentIndex].options.map((opt: string, i: number) => {
                  let btnClass = "w-full p-4 text-left rounded-xl border-2 transition-all font-medium ";
                  
                  if (selectedAnswer) {
                    if (opt === activeQuestions[currentIndex].answer) {
                      btnClass += "bg-green-100 border-green-500 text-green-800"; // Highlight correct
                    } else if (opt === selectedAnswer) {
                      btnClass += "bg-red-100 border-red-500 text-red-800"; // Highlight wrong selection
                    } else {
                      btnClass += "border-slate-100 text-slate-400 opacity-50"; // Fade others
                    }
                  } else {
                    btnClass += "border-slate-100 hover:border-indigo-600 hover:bg-indigo-50 text-slate-700 active:scale-[0.99]";
                  }

                  return (
                    <button
                      key={i}
                      onClick={() => handleAnswer(opt)}
                      disabled={!!selectedAnswer}
                      className={btnClass}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              
              {selectedAnswer && activeQuestions[currentIndex].explanation && (
                <div className="mt-6 p-4 bg-indigo-50 border border-indigo-100 rounded-xl animate-in slide-in-from-bottom-2 fade-in">
                  <h4 className="font-bold text-indigo-800 mb-1 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Explanation
                  </h4>
                  <p className="text-indigo-900 text-sm leading-relaxed">
                    {activeQuestions[currentIndex].explanation}
                  </p>
                </div>
              )}

              {selectedAnswer && (
                <div className="mt-8 flex justify-end animate-in fade-in">
                  <button
                    onClick={handleNextQuestion}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all active:scale-[0.98] shadow-md flex items-center gap-2"
                  >
                    {currentIndex < activeQuestions.length - 1 ? (
                      <>Next Question <ArrowRight className="w-5 h-5" /></>
                    ) : (
                      <>Finish Quiz <CheckCircle2 className="w-5 h-5" /></>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ANALYSIS */}
          {step === 'analysis' && (
            <div className="animate-in fade-in">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">Cycle Complete</h2>
                <p className="text-slate-500">Subtopics identified and saved.</p>
                <div className="mt-4 flex justify-center gap-4 flex-wrap">
                  <div className="inline-flex items-center gap-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-full font-medium">
                    <Clock className="w-4 h-4" /> Time Taken: {formatTime(elapsedTime)}
                  </div>
                  <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full font-medium">
                    <CheckCircle2 className="w-4 h-4" /> Correct: {answers.filter(a => a.isCorrect).length} / {answers.length}
                  </div>
                  {negativeMarking && (
                    <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full font-medium">
                      <Sparkles className="w-4 h-4" /> Score: {(answers.filter(a => a.isCorrect).length * 4) - (answers.filter(a => !a.isCorrect).length)}
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-8">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Session Performance</h3>
                <div className="space-y-2">
                  {(Object.entries(sessionProgress) as [string, {total: number, correct: number}][]).filter(([_, data]) => data.total > 0).map(([subtopic, data]) => {
                    const percentage = Math.round((data.correct / data.total) * 100);
                    return (
                      <div key={subtopic} className={`p-3 rounded-xl border ${getSubtopicColor(data.correct, data.total)} flex items-center justify-between`}>
                        <span className="font-semibold">{subtopic}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold">{percentage}%</span>
                          {percentage >= 80 ? <CheckCircle2 className="w-4 h-4 opacity-70" /> : <XCircle className="w-4 h-4 opacity-70" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mb-8">
                <button 
                  onClick={() => setShowReview(!showReview)}
                  className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-bold transition-all flex items-center justify-between"
                >
                  <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-500" /> Detailed Review</span>
                  {showReview ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                
                {showReview && (
                  <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in">
                    {answers.map((ans, idx) => (
                      <div key={idx} className={`p-5 rounded-xl border-2 ${ans.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                        <div className="flex items-start gap-3 mb-3">
                          <div className="mt-0.5">
                            {ans.isCorrect ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
                          </div>
                          <div>
                            <span className="text-xs font-bold uppercase tracking-wider opacity-60 mb-1 block">{ans.subtopic}</span>
                            <p className="font-semibold text-slate-800">{ans.text}</p>
                          </div>
                        </div>
                        
                        <div className="ml-8 space-y-2 text-sm">
                          <div className="flex flex-col gap-1">
                            <span className="text-slate-500 text-xs font-bold uppercase">Your Answer</span>
                            <p className={`font-medium ${ans.isCorrect ? 'text-green-700' : 'text-red-700'}`}>{ans.userAnswer}</p>
                          </div>
                          
                          {!ans.isCorrect && (
                            <div className="flex flex-col gap-1 mt-2">
                              <span className="text-slate-500 text-xs font-bold uppercase">Correct Answer</span>
                              <p className="font-medium text-green-700">{ans.answer}</p>
                            </div>
                          )}
                          
                          {ans.explanation && (
                            <div className="mt-4 pt-4 border-t border-black/5">
                              <span className="text-slate-500 text-xs font-bold uppercase mb-1 block">Explanation</span>
                              <p className="text-slate-700">{ans.explanation}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => {
                    setStep('select');
                  }}
                  className="w-full py-4 bg-white border-2 border-slate-200 hover:border-slate-300 text-slate-700 rounded-xl font-bold transition-all active:scale-[0.98]"
                >
                  New Topic
                </button>
                <button 
                  onClick={() => fetchQuestionsFromAI(true, false)}
                  disabled={isGenerating}
                  className="w-full py-4 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white rounded-xl font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <><RotateCcw className="w-5 h-5" /> Adapt Next</>}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
