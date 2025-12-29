import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="w-full py-6 mt-12 border-t border-gray-200 bg-white/50 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-4 flex justify-between items-center text-sm text-gray-500">
        <div>
          LIX Generator &copy; {new Date().getFullYear()}
        </div>
        <div className="flex items-center gap-4">
          <Link href="/changelog" className="hover:text-blue-600 transition-colors flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            v0.3.0
          </Link>
          <a href="https://github.com/rotwurstesser/lix-tool" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
