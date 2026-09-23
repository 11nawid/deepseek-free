"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { setLanguage, getLanguage, t, type Language } from "@/lib/i18n";
import { useTheme, type Theme } from "@/lib/theme-provider";

const CAT_ART = [
  `    /\\_/\\  `,
  `   ( o.o ) `,
  `    > ^ <  `,
  `   /|   |\\`,
  `  (_|   |_)`,
];

const CAT_DANCE_FRAMES = [
  [
    "    /\\_/\\  ",
    "   ( o.o ) ",
    "    > ^ <  ",
    "   /|   |\\",
    "  (_|   |_)",
  ],
  [
    "    /\\_/\\  ",
    "   ( o.o )~",
    "    > ^ <  ",
    "   /|   |\\~",
    "  (_|   |_)",
  ],
  [
    "    /\\_/\\  ",
    "  ~( o.o ) ",
    "    > ^ <  ",
    "  ~/|   |\\",
    "  (_|   |_)",
  ],
  [
    "    /\\_/\\  ",
    "   ( ^.^ ) ",
    "    > ^ <  ",
    "   /|\\ /|\\",
    "  (_|   |_)",
  ],
  [
    "    /\\_/\\  ",
    "   ( o.o ) ",
    "    > w <  ",
    "   /|   |\\",
    "  (_|   |_)",
  ],
  [
    "    /\\_/\\  ",
    "   ( -.- )~",
    "    > ^ <  ",
    "   /|   |\\~",
    "  (_|   |_)",
  ],
];

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [selectedLang, setSelectedLang] = useState<Language>("en");
  const [selectedTheme, setSelectedTheme] = useState<Theme>("system");
  const [catFrame, setCatFrame] = useState(0);
  const [danceDone, setDanceDone] = useState(false);
  const { setTheme } = useTheme();

  useEffect(() => {
    setSelectedLang(getLanguage());
  }, []);

  // Cat animation
  useEffect(() => {
    if (step !== 2) return;
    setCatFrame(0);
    setDanceDone(false);
    const interval = setInterval(() => {
      setCatFrame((prev) => {
        const next = prev + 1;
        if (next >= CAT_DANCE_FRAMES.length) {
          clearInterval(interval);
          setTimeout(() => setDanceDone(true), 800);
          return prev;
        }
        return next;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [step]);

  const handleNext = useCallback(() => {
    if (step === 0) {
      setLanguage(selectedLang);
      setStep(1);
    } else if (step === 1) {
      setTheme(selectedTheme);
      setStep(2);
    } else if (step === 2 && danceDone) {
      localStorage.setItem("onboarding-complete", "true");
      onComplete();
    }
  }, [step, selectedLang, selectedTheme, danceDone, onComplete, setTheme]);

  const handleBack = useCallback(() => {
    if (step > 0) setStep(step - 1);
  }, [step]);

  const texts = t();

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Background grid pattern */}
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />

      <div className="relative z-10 w-full max-w-lg px-6">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-10">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-8 bg-foreground"
                  : i < step
                    ? "w-2 bg-foreground/40"
                    : "w-2 bg-foreground/20"
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 0: Language */}
          {step === 0 && (
            <motion.div
              key="lang"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold text-foreground">
                  {texts.onboarding.welcome}
                </h1>
                <p className="text-foreground/60">{texts.onboarding.subtitle}</p>
              </div>

              <h2 className="text-xl font-semibold text-foreground text-center">
                {texts.onboarding.languageTitle}
              </h2>

              <div className="space-y-3">
                {(["en", "fa"] as Language[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setSelectedLang(lang)}
                    className={`w-full p-4 rounded-2xl border-2 transition-all duration-200 text-left ${
                      selectedLang === lang
                        ? "border-foreground bg-foreground/5"
                        : "border-foreground/10 hover:border-foreground/20 bg-panel"
                    }`}
                    dir={lang === "fa" ? "rtl" : "ltr"}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{lang === "en" ? "🇺🇸" : "🇮🇷"}</span>
                      <div>
                        <div className="font-medium text-foreground">
                          {lang === "en" ? "English" : "فارسی"}
                        </div>
                        <div className="text-sm text-foreground/50">
                          {lang === "en" ? "LTR layout" : "چیدمان راست به چپ"}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 1: Theme */}
          {step === 1 && (
            <motion.div
              key="theme"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <h2 className="text-xl font-semibold text-foreground text-center">
                {texts.onboarding.themeTitle}
              </h2>
              <p className="text-foreground/60 text-center">
                {texts.onboarding.themeDesc}
              </p>

              <div className="space-y-3">
                {([
                  { id: "light" as Theme, label: texts.onboarding.light, desc: texts.onboarding.lightDesc, icon: "☀️" },
                  { id: "dark" as Theme, label: texts.onboarding.dark, desc: texts.onboarding.darkDesc, icon: "🌙" },
                  { id: "system" as Theme, label: texts.onboarding.system, desc: texts.onboarding.systemDesc, icon: "💻" },
                ]).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedTheme(item.id);
                      setTheme(item.id);
                    }}
                    className={`w-full p-4 rounded-2xl border-2 transition-all duration-200 text-left ${
                      selectedTheme === item.id
                        ? "border-foreground bg-foreground/5"
                        : "border-foreground/10 hover:border-foreground/20 bg-panel"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{item.icon}</span>
                      <div>
                        <div className="font-medium text-foreground">{item.label}</div>
                        <div className="text-sm text-foreground/50">{item.desc}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 2: Cat dance animation */}
          {step === 2 && (
            <motion.div
              key="dance"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <h2 className="text-xl font-semibold text-foreground text-center">
                {texts.onboarding.enjoying}
              </h2>
              <p className="text-foreground/60 text-center">
                {texts.onboarding.enjoyDesc}
              </p>

              {/* Cat animation box */}
              <div className="flex justify-center">
                <div className="bg-panel rounded-3xl p-8 shadow-float border border-foreground/10">
                  <pre className="font-mono text-lg leading-tight text-foreground select-none text-center">
                    {(CAT_DANCE_FRAMES[catFrame] || CAT_DANCE_FRAMES[0]).map(
                      (line, i) => (
                        <motion.span
                          key={`${catFrame}-${i}`}
                          initial={{ opacity: 0.5 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.2 }}
                          className="block"
                        >
                          {line}
                        </motion.span>
                      )
                    )}
                  </pre>
                </div>
              </div>

              <AnimatePresence>
                {danceDone && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                  >
                    <span className="text-2xl">✨</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation buttons */}
        <div className="flex justify-between items-center mt-8">
          {step > 0 ? (
            <button
              onClick={handleBack}
              className="px-6 py-3 rounded-xl text-foreground/60 hover:text-foreground transition-colors"
            >
              {texts.onboarding.back}
            </button>
          ) : (
            <div />
          )}

          <button
            onClick={handleNext}
            disabled={step === 2 && !danceDone}
            className={`px-8 py-3 rounded-xl font-medium transition-all duration-200 ${
              step === 2 && !danceDone
                ? "bg-foreground/20 text-foreground/40 cursor-not-allowed"
                : "bg-foreground text-background hover:opacity-90"
            }`}
          >
            {step === 2
              ? texts.onboarding.getStarted
              : step === 0
                ? texts.onboarding.next
                : texts.onboarding.next}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
