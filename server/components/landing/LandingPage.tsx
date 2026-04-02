import React, { useEffect } from 'react';
import LandingHeader from './Header';
import Hero from './Hero';
import Comparison from './ProblemSolution';
import Education from './Education';
import Footer from './Footer';
import '../../premium-ui.css';

const LandingPage: React.FC = () => {
    useEffect(() => {
        // Scroll to top on mount
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="min-h-screen bg-white dark:bg-dark selection:bg-brand selection:text-dark">
            <LandingHeader />
            <main>
                <Hero />
                <Comparison />
                <Education />
            </main>
            <Footer />
        </div>
    );
};

export default LandingPage;
