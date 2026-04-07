import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Lazy Loading Utilities
 * Intersection Observer-based lazy loading for images and components
 */

// ==========================================
// LAZY IMAGE COMPONENT
// ==========================================

interface LazyImageProps {
 src: string;
 alt: string;
 placeholder?: React.ReactNode;
 fallback?: string;
 className?: string;
 onLoad?: () => void;
 onError?: () => void;
 threshold?: number;
 rootMargin?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({
 src,
 alt,
 placeholder,
 fallback,
 className = '',
 onLoad,
 onError,
 threshold = 0.1,
 rootMargin = '50px'
}) => {
 const [isLoaded, setIsLoaded] = useState(false);
 const [isInView, setIsInView] = useState(false);
 const [hasError, setHasError] = useState(false);
 const imgRef = useRef<HTMLImageElement>(null);

 useEffect(() => {
 const observer = new IntersectionObserver(
 ([entry]) => {
 if (entry.isIntersecting) {
 setIsInView(true);
 observer.disconnect();
 }
 },
 { threshold, rootMargin }
 );

 if (imgRef.current) {
 observer.observe(imgRef.current);
 }

 return () => observer.disconnect();
 }, [threshold, rootMargin]);

 const handleLoad = useCallback(() => {
 setIsLoaded(true);
 onLoad?.();
 }, [onLoad]);

 const handleError = useCallback(() => {
 setHasError(true);
 onError?.();
 }, [onError]);

 return (
 <div ref={imgRef as any} className={`relative overflow-hidden ${className}`}>
 {/* Placeholder */}
 {(!isLoaded || !isInView) && (
 <div className="absolute inset-0 bg-gray-200 dark:bg-white/5 animate-pulse">
 {placeholder}
 </div>
 )}

 {/* Actual Image */}
 {isInView && (
 <img
 src={hasError && fallback ? fallback : src}
 alt={alt}
 className={`w-full h-full object-cover transition-opacity duration-300 ${
 isLoaded ? 'opacity-100' : 'opacity-0'
 }`}
 onLoad={handleLoad}
 onError={handleError}
 loading="lazy"
 />
 )}
 </div>
 );
};

// ==========================================
// LAZY COMPONENT WRAPPER
// ==========================================

interface LazyComponentProps {
 loader: () => Promise<{ default: React.ComponentType<any> }>;
 fallback?: React.ReactNode;
 threshold?: number;
 rootMargin?: string;
 children?: React.ReactNode;
}

export const LazyComponent: React.FC<LazyComponentProps> = ({
 loader,
 fallback,
 threshold = 0.1,
 rootMargin = '100px',
 children
}) => {
 const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
 const [isLoading, setIsLoading] = useState(false);
 const [hasError, setHasError] = useState(false);
 const containerRef = useRef<HTMLDivElement>(null);

 useEffect(() => {
 const observer = new IntersectionObserver(
 ([entry]) => {
 if (entry.isIntersecting && !Component && !isLoading) {
 setIsLoading(true);
 observer.disconnect();

 loader()
 .then((mod) => {
 setComponent(() => mod.default);
 setIsLoading(false);
 })
 .catch((err) => {
 console.error('Failed to load component:', err);
 setHasError(true);
 setIsLoading(false);
 });
 }
 },
 { threshold, rootMargin }
 );

 if (containerRef.current) {
 observer.observe(containerRef.current);
 }

 return () => observer.disconnect();
 }, [loader, Component, isLoading, threshold, rootMargin]);

 if (hasError) {
 return (
 <div className="p-8 text-center text-gray-500 dark:text-gray-400">
 <p className="text-sm font-bold">Failed to load component</p>
 </div>
 );
 }

 if (!Component) {
 return (
 <div ref={containerRef}>
 {fallback || (
 <div className="w-full h-48 bg-gray-200 dark:bg-white/5 animate-pulse rounded-2xl" />
 )}
 </div>
 );
 }

 return <div ref={containerRef}>{children && <Component>{children}</Component>}</div>;
};

// ==========================================
// USE INTERSECTION OBSERVER HOOK
// ==========================================

interface UseIntersectionObserverOptions {
 threshold?: number | number[];
 rootMargin?: string;
 triggerOnce?: boolean;
 onChange?: (isInView: boolean, entry?: IntersectionObserverEntry) => void;
}

export const useIntersectionObserver = (
 options: UseIntersectionObserverOptions = {}
): [React.RefObject<HTMLDivElement | null>, boolean, IntersectionObserverEntry | undefined] => {
 const {
 threshold = 0,
 rootMargin = '0px',
 triggerOnce = true,
 onChange
 } = options;

 const [isInView, setIsInView] = useState(false);
 const [entry, setEntry] = useState<IntersectionObserverEntry>();
 const elementRef = useRef<HTMLDivElement>(null);
 const hasTriggered = useRef(false);

 useEffect(() => {
 const element = elementRef.current;
 if (!element) return;

 const observer = new IntersectionObserver(
 ([entry]) => {
 const isInView = entry.isIntersecting;
 setIsInView(isInView);
 setEntry(entry);

 if (onChange) {
 onChange(isInView, entry);
 }

 if (triggerOnce && isInView) {
 hasTriggered.current = true;
 observer.disconnect();
 }
 },
 { threshold, rootMargin }
 );

 observer.observe(element);

 return () => observer.disconnect();
 }, [threshold, rootMargin, triggerOnce, onChange]);

 return [elementRef as React.RefObject<HTMLDivElement>, isInView, entry];
};

// ==========================================
// LAZY LOADING IMAGE GALLERY
// ==========================================

interface LazyImageGalleryProps {
 images: Array<{ src: string; alt: string }>;
 className?: string;
 columns?: number;
 gap?: string;
}

export const LazyImageGallery: React.FC<LazyImageGalleryProps> = ({
 images,
 className = '',
 columns = 3,
 gap = '1rem'
}) => {
 return (
 <div
 className={`grid ${className}`}
 style={{
 gridTemplateColumns: `repeat(${columns}, 1fr)`,
 gap
 }}
 >
 {images.map((image, index) => (
 <LazyImage
 key={index}
 src={image.src}
 alt={image.alt}
 className="aspect-square rounded-2xl"
 threshold={0.1}
 rootMargin={`${index * 50}px`}
 />
 ))}
 </div>
 );
};

// ==========================================
// PROGRESSIVE IMAGE LOADER
// ==========================================

interface ProgressiveImageProps {
 lowResSrc: string;
 highResSrc: string;
 alt: string;
 className?: string;
}

export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
 lowResSrc,
 highResSrc,
 alt,
 className = ''
}) => {
 const [isHighResLoaded, setIsHighResLoaded] = useState(false);

 return (
 <div className={`relative overflow-hidden ${className}`}>
 {/* Low-res placeholder */}
 <img
 src={lowResSrc}
 alt={alt}
 className={`w-full h-full object-cover blur-md transition-opacity duration-300 ${
 isHighResLoaded ? 'opacity-0' : 'opacity-100'
 }`}
 />

 {/* High-res image */}
 <img
 src={highResSrc}
 alt={alt}
 className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
 isHighResLoaded ? 'opacity-100' : 'opacity-0'
 }`}
 onLoad={() => setIsHighResLoaded(true)}
 loading="lazy"
 />
 </div>
 );
};

export default {
 LazyImage,
 LazyComponent,
 useIntersectionObserver,
 LazyImageGallery,
 ProgressiveImage
};
