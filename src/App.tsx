/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  arrayUnion,
  onSnapshot
} from 'firebase/firestore';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { UserProfile, GameData, Question, LevelData } from './types';
import gameDataRaw from './data/questions.json';
import { 
  Trophy, 
  Star, 
  BookOpen, 
  HelpCircle, 
  LogOut, 
  LogIn, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  Image as ImageIcon,
  ChevronRight,
  ChevronLeft,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";

const gameData = gameDataRaw as GameData;

// Material 3 Colors
const COLORS = {
  primary: '#2E7D32',
  secondary: '#FFC107',
  background: '#F5F5F0',
  surface: '#FFFFFF',
  text: '#1A1A1A',
  muted: '#666666',
  error: '#B00020'
};

const DING_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const HADITH_QUOTES = [
  "Barangsiapa yang menempuh jalan untuk mencari ilmu, maka Allah akan memudahkan baginya jalan menuju surga. (HR. Muslim)",
  "Sebaik-baik kalian adalah yang mempelajari Al-Qur'an dan mengajarkannya. (HR. Bukhari)",
  "Senyummu di hadapan saudaramu adalah sedekah. (HR. Tirmidzi)",
  "Kebersihan itu sebagian dari iman. (HR. Muslim)",
  "Tuntutlah ilmu dari buaian hingga liang lahat.",
  "Sampaikanlah dariku walau hanya satu ayat. (HR. Bukhari)",
  "Tangan di atas lebih baik daripada tangan di bawah. (HR. Bukhari)",
  "Sesungguhnya setiap amal itu tergantung niatnya. (HR. Bukhari)"
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentLevelIdx, setCurrentLevelIdx] = useState(0);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'hint', message: string } | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [rewardImageUrl, setRewardImageUrl] = useState<string | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [hadithIdx, setHadithIdx] = useState(0);

  const currentLevel = gameData.game_data[currentLevelIdx];
  const currentQuestion = currentLevel.questions[currentQuestionIdx];
  const isCompleted = profile?.completedQuestions.includes(currentQuestion.id);

  // Hadith Rotation
  useEffect(() => {
    const interval = setInterval(() => {
      setHadithIdx((prev) => (prev + 1) % HADITH_QUOTES.length);
    }, 10000); // Rotate every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Profile Listener
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setProfile(snapshot.data() as UserProfile);
      } else {
        // Initialize profile
        const newProfile: UserProfile = {
          uid: user.uid,
          displayName: user.displayName || 'Hamba Allah',
          totalPoints: 0,
          completedQuestions: []
        };
        setDoc(doc(db, 'users', user.uid), newProfile);
        setProfile(newProfile);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  // Reset failed attempts when question changes
  useEffect(() => {
    setFailedAttempts(0);
  }, [currentLevelIdx, currentQuestionIdx]);

  const playDing = () => {
    const audio = new Audio(DING_SOUND);
    audio.play().catch(() => {}); // Ignore autoplay blocks
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || isCompleted) return;

    const normalizedInput = userInput.trim().toUpperCase().replace(/\s/g, '');
    const isCorrect = normalizedInput === currentQuestion.answer;

    if (isCorrect) {
      playDing();
      setFeedback({ type: 'success', message: `Maa syaa Allah! Benar. ${currentQuestion.fact_short}` });
      
      // Update Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        totalPoints: increment(currentQuestion.point_reward),
        completedQuestions: arrayUnion(currentQuestion.id)
      });

      setUserInput('');
    } else {
      const newFailedCount = failedAttempts + 1;
      setFailedAttempts(newFailedCount);
      
      if (newFailedCount >= 3) {
        setFeedback({ 
          type: 'error', 
          message: `Sudah 3x salah. Jawabannya adalah: ${currentQuestion.answer}. ${currentQuestion.fact_short}` 
        });
        
        // Mark as completed automatically
        await updateDoc(doc(db, 'users', user.uid), {
          completedQuestions: arrayUnion(currentQuestion.id)
        });
        setUserInput('');
      } else {
        setFeedback({ 
          type: 'error', 
          message: `Afwan, jawaban kurang tepat. Percobaan ke-${newFailedCount} dari 3. Coba lagi ya!` 
        });
      }
    }
  };

  const getHint = async () => {
    if (hintLoading) return;
    setHintLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Berikan petunjuk singkat (maksimal 10 kata) untuk pertanyaan TTS Islami ini tanpa menyebutkan jawabannya. 
        Pertanyaan: "${currentQuestion.clue}"
        Jawaban: "${currentQuestion.answer}"
        Gaya bahasa: Playful dan edukatif untuk semua umur.`,
      });
      setFeedback({ type: 'hint', message: `Petunjuk: ${response.text}` });
    } catch (error) {
      console.error(error);
      setFeedback({ type: 'error', message: 'Gagal mendapatkan petunjuk.' });
    } finally {
      setHintLoading(false);
    }
  };

  const generateRewardImage = async () => {
    if (rewardLoading) return;
    setRewardLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: `A beautiful, playful, and colorful Islamic-themed illustration representing "${currentQuestion.answer}" in a friendly cartoon style for kids. High quality, vibrant colors, Material 3 aesthetic.`,
            },
          ],
        },
      });
      
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setRewardImageUrl(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (error) {
      console.error(error);
      setFeedback({ type: 'error', message: 'Gagal membuat gambar hadiah.' });
    } finally {
      setRewardLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F0]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <RefreshCw className="w-12 h-12 text-[#2E7D32]" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F5F0] p-6 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-2xl w-full bg-white rounded-[32px] overflow-hidden shadow-xl border border-black/5"
        >
          <div className="w-full aspect-video bg-[#E8F5E9] relative overflow-hidden">
            <img 
              src="https://i.imgur.com/MtNNVZI.png" 
              alt="TTS Pintar Islami Banner" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                // Fallback if the image is not found
                e.currentTarget.src = 'https://picsum.photos/seed/islamic-game/1024/576';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
          </div>
          
          <div className="p-10">
            <h1 className="text-4xl font-serif font-bold text-[#2E7D32] mb-4">TTS Pintar Islami</h1>
            <p className="text-[#666666] mb-8 leading-relaxed max-w-md mx-auto">
              Selamat datang! Mari belajar Islam dengan cara yang seru, ceria, dan penuh hikmah.
            </p>
            <button 
              onClick={signInWithGoogle}
              className="w-full max-w-xs mx-auto py-4 bg-[#FFC107] hover:bg-[#FFB300] text-[#1A1A1A] font-bold rounded-2xl flex items-center justify-center gap-3 transition-all shadow-md active:scale-95"
            >
              <LogIn className="w-5 h-5" />
              Masuk dengan Google
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F0] font-sans text-[#1A1A1A] pb-20">
      {/* Header */}
      <header className="bg-white border-b border-black/5 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#2E7D32] rounded-xl flex items-center justify-center">
              <BookOpen className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-serif font-bold text-[#2E7D32] hidden sm:block">TTS Pintar Islami</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="bg-[#FFF8E1] px-4 py-2 rounded-full flex items-center gap-2 border border-[#FFC107]/30">
              <Star className="w-5 h-5 text-[#FFC107] fill-[#FFC107]" />
              <span className="font-bold text-[#2E7D32]">{profile?.totalPoints || 0} Poin</span>
            </div>
            <button 
              onClick={logout}
              className="p-2 hover:bg-black/5 rounded-full transition-colors"
              title="Keluar"
            >
              <LogOut className="w-5 h-5 text-[#666666]" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {/* Level Selection */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2 no-scrollbar">
          {gameData.game_data.map((level, idx) => (
            <button
              key={level.level}
              onClick={() => {
                setCurrentLevelIdx(idx);
                setCurrentQuestionIdx(0);
                setFeedback(null);
                setRewardImageUrl(null);
              }}
              className={`px-6 py-3 rounded-2xl font-bold whitespace-nowrap transition-all ${
                currentLevelIdx === idx 
                  ? 'bg-[#2E7D32] text-white shadow-lg scale-105' 
                  : 'bg-white text-[#666666] border border-black/5 hover:bg-black/5'
              }`}
            >
              Level {level.level}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Question Area */}
          <div className="lg:col-span-2 space-y-6">
            <motion.div 
              key={`${currentLevelIdx}-${currentQuestionIdx}`}
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="bg-white rounded-[32px] p-8 shadow-md border border-black/5 relative overflow-hidden"
            >
              {isCompleted && (
                <div className="absolute top-4 right-4 text-[#2E7D32]">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
              )}
              
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-[#FFC107] bg-[#FFF8E1] px-3 py-1 rounded-full">
                  Soal {currentQuestionIdx + 1} / {currentLevel.questions.length}
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-[#2E7D32] bg-[#E8F5E9] px-3 py-1 rounded-full">
                  +{currentQuestion.point_reward} Poin
                </span>
              </div>

              <h2 className="text-2xl font-serif font-bold mb-6 leading-tight">
                {currentQuestion.clue}
              </h2>

              <div className="flex flex-wrap gap-2 mb-8">
                {currentQuestion.answer.split('').map((_, i) => (
                  <div 
                    key={i}
                    className={`w-10 h-12 sm:w-12 sm:h-14 border-2 rounded-xl flex items-center justify-center text-xl font-bold ${
                      isCompleted 
                        ? 'bg-[#E8F5E9] border-[#2E7D32] text-[#2E7D32]' 
                        : 'bg-[#F5F5F0] border-black/5 text-[#1A1A1A]'
                    }`}
                  >
                    {isCompleted ? currentQuestion.answer[i] : ''}
                  </div>
                ))}
              </div>

              {!isCompleted ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <input 
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Ketik jawaban di sini..."
                    className="w-full p-4 bg-[#F5F5F0] border-2 border-transparent focus:border-[#2E7D32] rounded-2xl outline-none text-lg font-bold transition-all"
                    maxLength={currentQuestion.answer.length}
                  />
                  <div className="flex gap-3">
                    <button 
                      type="submit"
                      className="flex-1 py-4 bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-bold rounded-2xl shadow-md transition-all active:scale-95"
                    >
                      Jawab
                    </button>
                    <button 
                      type="button"
                      onClick={getHint}
                      disabled={hintLoading}
                      className="px-4 py-4 bg-white border-2 border-[#FFC107] text-[#FFC107] font-bold rounded-2xl hover:bg-[#FFF8E1] transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {hintLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                      <span className="text-sm">Clue</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-[#E8F5E9] rounded-2xl border border-[#2E7D32]/20">
                    <p className="text-[#2E7D32] font-medium italic">
                      "{currentQuestion.fact_short}"
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={generateRewardImage}
                      disabled={rewardLoading}
                      className="flex-1 py-4 bg-[#FFC107] hover:bg-[#FFB300] text-[#1A1A1A] font-bold rounded-2xl shadow-md transition-all flex items-center justify-center gap-2"
                    >
                      {rewardLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                      Lihat Gambar Hadiah
                    </button>
                  </div>
                </div>
              )}
            </motion.div>

            <AnimatePresence>
              {feedback && (
                <motion.div 
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 10, opacity: 0 }}
                  className={`p-4 rounded-2xl flex items-start gap-3 border ${
                    feedback.type === 'success' ? 'bg-[#E8F5E9] border-[#2E7D32] text-[#2E7D32]' :
                    feedback.type === 'hint' ? 'bg-[#FFF8E1] border-[#FFC107] text-[#856404]' :
                    'bg-[#FFEBEE] border-[#B00020] text-[#B00020]'
                  }`}
                >
                  {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 mt-0.5" /> :
                   feedback.type === 'hint' ? <HelpCircle className="w-5 h-5 mt-0.5" /> :
                   <AlertCircle className="w-5 h-5 mt-0.5" />}
                  <p className="font-medium">{feedback.message}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex justify-between items-center px-2">
              <button 
                onClick={() => {
                  setCurrentQuestionIdx(prev => Math.max(0, prev - 1));
                  setFeedback(null);
                  setRewardImageUrl(null);
                }}
                disabled={currentQuestionIdx === 0}
                className="p-3 rounded-full bg-white border border-black/5 hover:bg-black/5 disabled:opacity-30 transition-all"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button 
                onClick={() => {
                  setCurrentQuestionIdx(prev => Math.min(currentLevel.questions.length - 1, prev + 1));
                  setFeedback(null);
                  setRewardImageUrl(null);
                }}
                disabled={currentQuestionIdx === currentLevel.questions.length - 1}
                className="p-3 rounded-full bg-white border border-black/5 hover:bg-black/5 disabled:opacity-30 transition-all"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Sidebar / Stats */}
          <div className="space-y-6">
            <div className="bg-white rounded-[32px] p-6 shadow-md border border-black/5">
              <h3 className="font-serif font-bold text-lg mb-4 flex items-center gap-2">
                <Trophy className="text-[#FFC107] w-5 h-5" />
                Progress Level
              </h3>
              <div className="space-y-3">
                {currentLevel.questions.map((q, i) => (
                  <div 
                    key={q.id}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      profile?.completedQuestions.includes(q.id)
                        ? 'bg-[#E8F5E9] border-[#2E7D32]/20'
                        : i === currentQuestionIdx
                        ? 'bg-[#FFF8E1] border-[#FFC107]/20'
                        : 'bg-[#F5F5F0] border-transparent'
                    }`}
                  >
                    <span className="text-sm font-bold">Soal {i + 1}</span>
                    {profile?.completedQuestions.includes(q.id) ? (
                      <CheckCircle2 className="w-4 h-4 text-[#2E7D32]" />
                    ) : (
                      <span className="text-xs text-[#666666]">+{q.point_reward} pts</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {rewardImageUrl && (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white rounded-[32px] p-4 shadow-md border border-black/5"
              >
                <div className="aspect-square rounded-2xl overflow-hidden mb-3 bg-[#F5F5F0]">
                  <img 
                    src={rewardImageUrl} 
                    alt="Reward" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <p className="text-center text-xs font-bold text-[#2E7D32] uppercase tracking-widest">
                  Hadiah Visual Level Ini!
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-4xl mx-auto px-6 py-8 text-center border-t border-black/5 mt-10">
        <AnimatePresence mode="wait">
          <motion.p 
            key={hadithIdx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-sm text-[#666666] font-serif italic min-h-[40px]"
          >
            "{HADITH_QUOTES[hadithIdx]}"
          </motion.p>
        </AnimatePresence>
      </footer>
    </div>
  );
}
