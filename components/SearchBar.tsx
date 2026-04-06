import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
 onSearch: (query: string) => void;
 placeholder?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, placeholder = 'Search...' }) => {
 const [query, setQuery] = useState('');

 useEffect(() => {
 const timer = setTimeout(() => {
 onSearch(query);
 }, 500);

 return () => clearTimeout(timer);
 }, [query, onSearch]);

 return (
 <div className="relative group w-full max-w-md">
 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
 <Search size={18} className="text-gray-400 dark:text-white/20 group-focus-within:text-brand transition-colors" />
 </div>
 <input
 type="text"
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder={placeholder}
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-2xl py-3 pl-12 pr-12 text-sm font-medium text-dark dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 focus:outline-none focus:border-brand dark:focus:border-brand/40 focus:bg-white dark:focus:bg-white/10 transition-all"
 />
 {query && (
 <button
 onClick={() => setQuery('')}
 className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 dark:text-white/20 hover:text-red-500 dark:hover:text-red-400 transition-colors"
 >
 <X size={18} />
 </button>
 )}
 </div>
 );
};

export default SearchBar;
