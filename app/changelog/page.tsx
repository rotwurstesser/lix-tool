import Link from 'next/link';

export default function ChangelogPage() {
  const versions = [
    {
      version: 'v0.3.2',
      date: '2025-12-29',
      title: 'Precision Overhaul',
      changes: [
        'Switched default model to DeepSeek R1 for superior mathematical reasoning',
        'Enhanced prompting with explicit sentence/word counting steps',
        'Increased max retry attempts to 5',
        'Set temperature to 0.0 for maximum determinism'
      ]
    }, {
      version: 'v0.3.1',
      date: '2025-12-29',
      title: 'Build Stability Fix',
      changes: [
        'Moved prompt initialization to runtime to prevent build failures in serverless environments',
        'Fixed top-level API client initialization architecture',
        'Resolved lingering linting issues',
        'Updated Next.js to resolve CVE-2025-55182 security block'
      ]
    },
    {
      version: 'v0.3.0',
      date: '2025-12-29',
      title: 'Precision Update with TNG-Chimera',
      changes: [
        'Migrated backend to OpenRouter API',
        'integrated TNG R1t Chimera model for high-precision storytelling',
        'Implemented strict mathematical constraint enforcement',
        'Added fuzzy matching tolerance functionality',
        'Resolved merge conflicts between precision and fuzziness features'
      ]
    },
    {
      version: 'v0.2.0',
      date: '2025-11-28',
      title: 'Claude 4.5 & Fuzziness Features',
      changes: [
        'Updated to Claude 4.5 models',
        'Added "Tolerance" setting for LIX scores',
        'Improved UI for LIX balancing',
        'Added live generation attempt visualization'
      ]
    },
    {
      version: 'v0.1.0',
      date: '2025-11-28',
      title: 'Initial Release',
      changes: [
        'Initial LIX calculator implementation',
        'Basic story generation with Claude 3.5 Sonnet',
        'Core UI components'
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-800 flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Generator
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Changelog</h1>
          <p className="text-gray-600 mt-2">Version history and release notes.</p>
        </div>

        <div className="space-y-8">
          {versions.map((v) => (
            <div key={v.version} className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-gray-900">{v.version}</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {v.title}
                  </span>
                </div>
                <time className="text-sm text-gray-500">{v.date}</time>
              </div>
              <div className="p-6">
                <ul className="space-y-2">
                  {v.changes.map((change, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-700">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
