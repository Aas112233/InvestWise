import React, { useEffect } from 'react';
import LandingHeader from './Header';
import Hero from './Hero';
import Features from './ProblemSolution';
import HowItWorks from './Education';
import SecuritySection from './SecuritySection';
import { Marquee, Testimonials } from './SocialProof';
import Footer from './Footer';
import '../../premium-ui.css';

const LandingPage: React.FC = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-dark selection:bg-brand/20 selection:text-dark dark:selection:text-white">
      <LandingHeader />
      <main>
        <Hero />
        <Marquee />
        <Features />
        <HowItWorks />
        <SecuritySection />
        <Testimonials />
      </main>
      <Footer />
    </div>
  );
};

export default LandingPage;
