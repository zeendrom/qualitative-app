"use client";
import { useState, useMemo, useEffect, useRef } from 'react';
import { PromptConfig, DEFAULT_PROMPTS, PROMPT_META, buildQaChatPrompt, sanitizePromptConfig } from './prompts';

// --- DB SCHEMA TYPES (8 Normalized Tables) ---
interface Project { id: string; name: string; createdAt: string; updatedAt?: string; }
interface ProjectParameter { id: string; projectId: string; content: string; versionLabel: string; createdAt: string; isActive: boolean; }
interface AppDocument { id: string; projectId: string; title: string; content: string; }
interface TextChunk { id: string; documentId: string; sequenceNum: number; content: string; startIndex: number; endIndex: number; }
interface MacroTheme { id: string; projectId: string; name: string; }
interface Code { id: string; projectId: string; themeId?: string; name: string; color: string; description?: string; }
interface Annotation { id: string; chunkId: string; codeId?: string; parameterVersionId: string; quote: string; rationale: string; createdBy: 'AI' | 'MANUAL'; startIndex: number; endIndex: number; }
interface AnnotationHistory { id: string; annotationId: string; oldRationale: string; newRationale: string; changedAt: string; }

type ChatMessage = { role: 'user' | 'ai'; content: string; };

const COLORS = ['#fca5a5', '#fdba74', '#fcd34d', '#86efac', '#6ee7b7', '#93c5fd', '#a5b4fc', '#d8b4fe', '#f9a8d4'];

const IDB_NAME = 'CaqdasLocalDB';
const IDB_STORE = 'autosave';

const saveToIDB = (data: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = (e: any) => { e.target.result.createObjectStore(IDB_STORE); };
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) return resolve();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      if (data.projects && data.projects.length > 0) {
        data.projects[0].updatedAt = new Date().toISOString();
      }
      const key = data.projects && data.projects.length > 0 ? data.projects[0].id : 'latest_session';
      tx.objectStore(IDB_STORE).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    };
    request.onerror = () => reject();
  });
};

const getAllFromIDB = (): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = (e: any) => { e.target.result.createObjectStore(IDB_STORE); };
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) return resolve([]);
      const tx = db.transaction(IDB_STORE, 'readonly');
      const getReq = tx.objectStore(IDB_STORE).getAll();
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject([]);
    };
    request.onerror = () => reject([]);
  });
};

const deleteFromIDB = (key: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = (e: any) => { e.target.result.createObjectStore(IDB_STORE); };
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    };
    request.onerror = () => reject();
  });
};

export default function Home() {
  // DB State (8 Relational Tables)
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectParameters, setProjectParameters] = useState<ProjectParameter[]>([]);
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [textChunks, setTextChunks] = useState<TextChunk[]>([]);
  const [macroThemes, setMacroThemes] = useState<MacroTheme[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationHistories, setAnnotationHistories] = useState<AnnotationHistory[]>([]);
  
  // Active UI View State
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  
  // AI State
  const [apiKey, setApiKey] = useState<string>('');
  const [chatInput, setChatInput] = useState<string>('');
  const [apiProvider, setApiProvider] = useState<'gemini' | 'openai' | 'groq'>('gemini');
  const [draftParameter, setDraftParameter] = useState('');
  const [viewingProtocolId, setViewingProtocolId] = useState<string | null>(null);
  const [showProtocolDiffModal, setShowProtocolDiffModal] = useState(false);
  const [diffTargetId, setDiffTargetId] = useState<string | null>(null);
  // UI State
  const [appScreen, setAppScreen] = useState<'launcher' | 'workspace'>('launcher');
  const [savedSessions, setSavedSessions] = useState<any[]>([]);
  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isAutoCoding, setIsAutoCoding] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'autocode'>('chat');
  const [codingProgress, setCodingProgress] = useState<{chunkIdx: number; total: number; docName: string; chunkPreview: string; latestCodes: string[]; countdown?: number} | null>(null);
  const [chunkDelay, setChunkDelay] = useState<number>(0);
  const [mainViewMode, setMainViewMode] = useState<'text' | 'table' | 'visual' | 'audit'>('text');
  const [autoCodingMode, setAutoCodingMode] = useState<'invivo' | 'narrative'>('invivo');
  const [scrollIndexMap, setScrollIndexMap] = useState<Record<string, number>>({});
  const [isAutoTheme, setIsAutoTheme] = useState(false);
  const [matrixSubTab, setMatrixSubTab] = useState<'code' | 'theme'>('code');
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const toggleTheme = (id: string) => setExpandedThemes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [matrixSplitRatio, setMatrixSplitRatio] = useState(75);
  const [matrixColWidths, setMatrixColWidths] = useState<Record<string, number>>({
    'c_doc': 180, 'c_theme': 150, 'c_code': 150, 'c_quote': 350, 'c_rat': 300,
    't_code': 140, 't_doc': 160, 't_quote': 300, 't_rat': 250
  });
  const [isHoveringMatriks, setIsHoveringMatriks] = useState(false);

  const handleColumnResize = (key: string, startX: number, startWidth: number) => (e: MouseEvent) => {
    const delta = e.clientX - startX;
    setMatrixColWidths(prev => ({ ...prev, [key]: Math.max(50, startWidth + delta) }));
  };  
  const [selectionBox, setSelectionBox] = useState<{x:number, y:number, quote:string, startIndex:number, endIndex:number, chunkId:string} | null>(null);
  const [newCodeName, setNewCodeName] = useState('');
  const [newInitialNoting, setNewInitialNoting] = useState('');
  const [dragPanelOffset, setDragPanelOffset] = useState<{x:number, y:number}>({x:0, y:0});
  
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDraft, setExportDraft] = useState('');
  const [exportType, setExportType] = useState<'csv' | 'md' | 'txt' | 'qdc'>('csv');
  const [showExportPickerModal, setShowExportPickerModal] = useState(false);

  const frequentWords = useMemo(() => {
    if (mainViewMode !== 'visual') return [];
    let textData = textChunks.map(t => t.content).join(' ').toLowerCase();
    const words = textData.match(/[a-z]+/g) || [];
    const counts: Record<string, number> = {};
    for (const w of words) if (w.length > 4) counts[w] = (counts[w] || 0) + 1;
    const stopwords = new Set(['dalam', 'untuk', 'dengan', 'tidak', 'adalah', 'bahwa', 'sebagai', 'kepada', 'karena', 'seperti', 'mereka', 'sebuah', 'menjadi', 'tersebut', 'yang', 'dari', 'pada']);
    return Object.entries(counts).filter(([w]) => !stopwords.has(w)).sort((a,b)=>b[1]-a[1]).slice(0, 15);
  }, [mainViewMode, textChunks]);

  const [promptConfig, setPromptConfig] = useState<PromptConfig>(DEFAULT_PROMPTS);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [editingPromptKey, setEditingPromptKey] = useState<keyof PromptConfig>('openCoding');
  const [promptDraft, setPromptDraft] = useState('');

  // Load / Save Local Keys
  useEffect(() => {
    const savedKey = localStorage.getItem('app_apiKey');
    const savedProv = localStorage.getItem('app_apiProvider');
    if (savedKey) setApiKey(savedKey);
    if (savedProv) setApiProvider(savedProv as any);

    getAllFromIDB().then(sessions => {
      if (sessions && sessions.length > 0) {
        const sorted = sessions.sort((a,b) => {
           const timeA = a.projects?.[0]?.updatedAt ? new Date(a.projects[0].updatedAt).getTime() : (a.projects?.[0]?.createdAt ? new Date(a.projects[0].createdAt).getTime() : 0);
           const timeB = b.projects?.[0]?.updatedAt ? new Date(b.projects[0].updatedAt).getTime() : (b.projects?.[0]?.createdAt ? new Date(b.projects[0].createdAt).getTime() : 0);
           return timeB - timeA;
        });
        setSavedSessions(sorted);
        // Muat konfigurasi prompt dari sesi terakhir jika tersedia
        if (sorted[0]?.promptConfig) setPromptConfig(sanitizePromptConfig(sorted[0].promptConfig));
      }
    }).catch(()=>{});
  }, []);

  // Debounced Auto-Backup (IndexedDB)
  useEffect(() => {
    if (appScreen !== 'workspace' || projects.length === 0) return;
    const timer = setTimeout(() => {
      saveToIDB({ projects, projectParameters, documents, textChunks, macroThemes, codes, annotations, annotationHistories, chatHistory, promptConfig }).catch(()=>{});
    }, 2000);
    return () => clearTimeout(timer);
  }, [appScreen, projects, projectParameters, documents, textChunks, macroThemes, codes, annotations, annotationHistories, chatHistory, promptConfig]);

  const updateKey = (val: string) => {
    setApiKey(val);
    localStorage.setItem('app_apiKey', val);
  };
  const handleProviderChange = (val: any) => { setApiProvider(val); localStorage.setItem('app_apiProvider', val); };

  const currentDoc = documents.find(d => d.id === activeDocId);

  // --- Multi-File I/O & Token Chunking ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    
    // Auto-init Project if none exists
    let currProj: Project;
    if (projects.length === 0) {
      currProj = { id: crypto.randomUUID(), name: 'Proyek Auto-Init', createdAt: new Date().toISOString() };
      setProjects([currProj]);
    } else { currProj = projects[0]; }

    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        const newDocId = crypto.randomUUID();
        const newDoc: AppDocument = { id: newDocId, projectId: currProj.id, title: file.name, content: text };
        
        // Anti-Token Limit: Hard Chunking (~600 chars max per request, hemat TPM Groq)
        const chunks: TextChunk[] = [];
        let seq = 0;
        let pos = 0;
        while (pos < text.length) {
            let nextPos = pos + 600;
            if (nextPos < text.length) {
                let breakPos = text.lastIndexOf('\n', nextPos);
                if (breakPos <= pos) {
                    breakPos = text.lastIndexOf(' ', nextPos);
                    if (breakPos <= pos) breakPos = nextPos;
                }
                nextPos = breakPos;
            }
            
            const chunkContent = text.slice(pos, nextPos).trim();
            if (chunkContent.length > 0) {
              chunks.push({
                  id: crypto.randomUUID(), documentId: newDocId, sequenceNum: seq++,
                  content: chunkContent,
                  startIndex: pos, endIndex: nextPos
              });
            }
            pos = nextPos;
            // Lewati spasi/enter berlebih
            while(pos < text.length && (text[pos] === ' ' || text[pos] === '\n' || text[pos] === '\r')) pos++;
        }

        setDocuments(prev => [...prev, newDoc]);
        setTextChunks(prev => [...prev, ...chunks]);
        if (!activeDocId) setActiveDocId(newDocId);
      };
      reader.readAsText(file);
    });
  };

  // --- External IO Backup ---
  const saveProject = () => {
    const payload = JSON.stringify({ projects, projectParameters, documents, textChunks, macroThemes, codes, annotations, annotationHistories, chatHistory });
    const blob = new Blob([payload], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'caqdas_db.qprj'; a.click();
  };
  
  const loadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const d = JSON.parse(evt.target?.result as string);
        if (d.projects) setProjects(d.projects); 
        if (d.projectParameters) setProjectParameters(d.projectParameters);
        if (d.documents) setDocuments(d.documents);
        if (d.textChunks) setTextChunks(d.textChunks); 
        if (d.macroThemes) setMacroThemes(d.macroThemes);
        if (d.codes) setCodes(d.codes); 
        if (d.annotations) setAnnotations(d.annotations);
        if (d.annotationHistories) setAnnotationHistories(d.annotationHistories);
        setAppScreen('workspace');
      } catch(e) { alert("Format backup DB rusak/korup!"); }
    };
    reader.readAsText(f);
  };

  // --- Engine LLM Fallback ---
  const workingModelRef = useRef<string | null>(null);
  // Flag pembatalan auto-coding
  const cancelAutoCodingRef = useRef<boolean>(false);

  const executeLLM = async (systemPrompt: string, userText: string): Promise<string> => {
    if (!apiKey.trim()) throw new Error("API Key kosong!");

    try {
        if (apiProvider === 'gemini') {
            // Jika sudah ada model yang terbukti berhasil, langsung pakai tanpa fallback
            if (workingModelRef.current) {
              try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${workingModelRef.current}:generateContent?key=${apiKey}`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    systemInstruction: { parts: [{text: systemPrompt}] },
                    contents: [{role: 'user', parts: [{text: userText}]}]
                  })
                });
                const data = await res.json();
                if (!data.error) return data.candidates[0].content.parts[0].text;
                // Jika model cache gagal (misal rate limit), hapus cache dan fallback ke list
                workingModelRef.current = null;
              } catch {
                workingModelRef.current = null;
              }
            }

            // Fallback: coba satu per satu, prioritaskan model yang sudah terbukti ada
            const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'];
            let errorLog: string[] = [];
            for (const mod of modelsToTry) {
               try {
                  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      systemInstruction: { parts: [{text: systemPrompt}] },
                      contents: [{role: 'user', parts: [{text: userText}]}]
                    })
                  });
                  const data = await res.json();
                  if (data.error) throw new Error(data.error.message);
                  // Cache model yang berhasil untuk panggilan berikutnya
                  workingModelRef.current = mod;
                  return data.candidates[0].content.parts[0].text;
               } catch (err: any) {
                  errorLog.push(`[${mod}] ${err.message}`);
               }
            }
            throw new Error(errorLog.join(' | '));
        } else if (apiProvider === 'groq' || apiProvider === 'openai') {
            const base = apiProvider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
            // Groq: pakai llama-3.1-8b-instant (TPM 30.000) — jauh lebih aman dari llama-3.3-70b (TPM 12.000)
            const model = apiProvider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini';
            // Groq: potong system prompt tapi PERTAHANKAN bagian akhir (skema JSON)
            // sehingga model tetap tahu format output yang diinginkan
            const safeSystem = apiProvider === 'groq' && systemPrompt.length > 2000
              ? systemPrompt.slice(0, 900) + '\n...\n' + systemPrompt.slice(-900)
              : systemPrompt;
            // Potong user text untuk menjaga total token tetap aman
            const safeUser = apiProvider === 'groq' && userText.length > 1200
              ? userText.slice(0, 1200) + '\n[...teks dipotong untuk hemat TPM]'
              : userText;
            const res = await fetch(base, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({ model, max_tokens: 1024, messages: [ {role: 'system', content: safeSystem}, {role: 'user', content: safeUser} ] })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices[0].message.content;
        }
    } catch (e: any) {
        console.warn(`API Request failed:`, e.message);
        throw e; 
    }
    return "";
  };

  // --- Pure Inductive Open Coding (Context Isolated) ---
  const runAutoCoding = async () => {
    if (!activeDocId) { alert('Pilih dokumen terlebih dahulu di panel kiri sebelum menjalankan Auto-Code.'); return; }
    
    // Proses semua chunk dari dokumen, biarkan AI menambah kode berlapis (append) tanpa menghapus yang lama
    const activeChunks = textChunks.filter(c => c.documentId === activeDocId);
    if (activeChunks.length === 0) { alert('Dokumen yang dipilih tidak memiliki segmen teks.'); return; }
    
    cancelAutoCodingRef.current = false;
    setIsAutoCoding(true);
    setCodingProgress(null);

    const sysPrompt = autoCodingMode === 'invivo' ? promptConfig.openCoding : promptConfig.narrativeCoding;

    try {
        const activeProtocol = projectParameters.find(p => p.isActive);
        const finalPrompt = sysPrompt + (activeProtocol ? `\n\n[DOKTRIN PROTOKOL PENELITIAN AKTIF]\nAnda wajib menaati fokus riset berikut dalam melakukan ekstraksi:\n${activeProtocol.content}` : '');
        let newCodes = [...codes];
        
        // Pertahankan SEMUA anotasi yang sudah ada di database (Manual maupun AI sebelumnya) untuk skenario multi-layer coding
        let newAnns = [...annotations];
        const projId = projects.length > 0 ? projects[0].id : 'proj-1';
        let successCount = 0;
        let failCount = 0;
        let lastErrStr = '';
        const totalChunks = activeChunks.length;
        const activeDoc = documents.find(d => d.id === activeDocId);

        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

        // Deteksi penutur terakhir di akhir setiap chunk untuk diteruskan sebagai konteks
        let lastSpeakerContext = '';
        const SPEAKER_PATTERNS = [
          /(?:^|\n)(P|Peneliti|Pewawancara|Interviewer)\s*:/i,
          /(?:^|\n)(N|Narasumber|Informan|Partisipan)\s*:/i,
        ];
        const detectLastSpeaker = (text: string): string => {
          const lines = text.split('\n').filter(l => l.trim());
          for (let i = lines.length - 1; i >= 0; i--) {
            if (/^(P|Peneliti|Pewawancara|Interviewer)\s*:/i.test(lines[i].trim())) return 'Pewawancara';
            if (/^(N|Narasumber|Informan|Partisipan|[A-Z][a-z]+)\s*:/i.test(lines[i].trim())) return 'Partisipan';
          }
          return '';
        };

        for (let ci = 0; ci < activeChunks.length; ci++) {
            // --- CEK PEMBATALAN ---
            if (cancelAutoCodingRef.current) {
                // Simpan hasil parsial yang sudah ada sebelum berhenti
                setCodes([...newCodes]);
                setAnnotations([...newAnns]);
                alert(`⛔ Dibatalkan. Hasil parsial dari ${successCount} segmen telah disimpan.`);
                break;
            }

            const chunk = activeChunks[ci];
            const informantName = activeDoc ? activeDoc.title : 'Tidak diketahui';

            // Jeda antar-chunk jika ada setting delay (untuk menghindari rate limit)
            if (ci > 0 && chunkDelay > 0) {
                for (let t = chunkDelay; t > 0; t--) {
                    if (cancelAutoCodingRef.current) break;
                    setCodingProgress(prev => prev ? {...prev, countdown: t} : null);
                    await sleep(1000);
                }
                if (cancelAutoCodingRef.current) continue;
            }

            // Update progress sebelum request
            setCodingProgress({
              chunkIdx: ci + 1,
              total: totalChunks,
              docName: informantName,
              chunkPreview: chunk.content.substring(0, 120).replace(/\n/g, ' ') + (chunk.content.length > 120 ? '...' : ''),
              latestCodes: newCodes.slice(-5).map(c => c.name),
            });

            try {
                const speakerCtx = lastSpeakerContext
                  ? `[KONTEKS PENUTUR SEBELUMNYA: Potongan sebelumnya berakhir dengan ucapan ${lastSpeakerContext}. Gunakan ini untuk menentukan siapa yang bicara di awal potongan ini jika tidak ada penanda eksplisit.]\n`
                  : '';
                const contextStr = `[Konteks Informan: ${informantName}]\n${speakerCtx}--- POTONGAN TEKS ---\n${chunk.content}\n--- SELESAI ---`;
                // Retry otomatis jika kena rate limit (429)
                let resultString = '';
                let retries = 0;
                while (retries < 3) {
                  try {
                    resultString = await executeLLM(finalPrompt, contextStr);
                    break;
                  } catch (retryErr: any) {
                    if (retryErr.message?.includes('rate limit') || retryErr.message?.includes('Rate limit')) {
                      const waitSec = 15;
                      for (let t = waitSec; t > 0; t--) {
                        setCodingProgress(prev => prev ? {...prev, countdown: t} : null);
                        await sleep(1000);
                      }
                      retries++;
                    } else throw retryErr;
                  }
                }
                if (!resultString) throw new Error('Gagal setelah 3 kali retry (rate limit).');
                const rawText = resultString.replace(/```json/g, '').replace(/```/g, '').trim();

                // Fungsi pemulihan JSON terpotong (Unterminated string)
                const recoverJSON = (raw: string): any => {
                  try { return JSON.parse(raw); } catch {}
                  // Coba potong di akhir objek terakhir yang lengkap
                  const lastComplete = raw.lastIndexOf('},');
                  if (lastComplete > 0) {
                    const fixed = raw.slice(0, lastComplete + 1) + ']}}';
                    try { return JSON.parse(fixed); } catch {}
                    const fixed2 = raw.slice(0, lastComplete + 1) + ']}';
                    try { return JSON.parse(fixed2); } catch {}
                  }
                  // Coba ambil array saja dengan regex
                  const arrMatch = raw.match(/(open_codes|narrative_codes)"\s*:\s*([\s\S]*)/);
                  if (arrMatch) {
                    const arrStr = arrMatch[2].replace(/,?\s*\}?\s*\]?\s*$/, '') + ']}';
                    try { return JSON.parse(`{"${arrMatch[1]}":${arrStr}`); } catch {}
                  }
                  throw new Error('Format JSON tidak dapat dipulihkan');
                };

                const parsed = recoverJSON(rawText);

                const generatedCodes = parsed.open_codes || parsed.narrative_codes || [];

                if (generatedCodes && Array.isArray(generatedCodes)) {
                    generatedCodes.forEach((oc: any) => {
                        const qText = oc.quote.trim();
                        let localStart = typeof oc.start_index === 'number' ? oc.start_index : -1;
                        if (localStart === -1 || chunk.content.substring(localStart, oc.end_index)?.trim() !== qText) {
                            localStart = chunk.content.indexOf(qText);
                        }
                        
                        if (localStart !== -1) {
                            let existingCode = newCodes.find(co => co.name.toLowerCase() === oc.code_name.toLowerCase());
                            if (!existingCode) { 
                                existingCode = { id: crypto.randomUUID(), projectId: projId, name: oc.code_name, color: COLORS[newCodes.length % COLORS.length], description: oc.rationale }; 
                                newCodes.push(existingCode);
                            }

                            // Cek agar tidak menduplikasi tagging yang 100% sama (jika tombol tertekan 2x)
                            const isDuplicate = newAnns.some(a => a.chunkId === chunk.id && a.codeId === existingCode.id && a.startIndex === localStart);
                            
                            if (!isDuplicate) {
                                newAnns.push({ 
                                  id: crypto.randomUUID(), chunkId: chunk.id, codeId: existingCode.id, parameterVersionId: activeProtocol?.id || 'orphan',
                                  quote: qText, rationale: oc.rationale, createdBy: 'AI',
                                  startIndex: localStart, endIndex: localStart + qText.length 
                                });
                            }
                        }
                    });

                    // Update progress dengan kode baru dari chunk ini
                    setCodingProgress(prev => prev ? { ...prev, latestCodes: newCodes.slice(-6).map(c => c.name) } : null);
                    successCount++;
                } else {
                    throw new Error('Format JSON dari LLM tidak memiliki open_codes atau narrative_codes');
                }
                // Update konteks penutur terakhir untuk chunk berikutnya
                const detected = detectLastSpeaker(chunk.content);
                if (detected) lastSpeakerContext = detected;
                setCodes([...newCodes]);
                setAnnotations([...newAnns]);
            } catch (chunkErr: any) {
                console.warn(`Chunk ${chunk.sequenceNum} gagal diproses:`, chunkErr.message);
                lastErrStr = chunkErr.message;
                failCount++;
            }
        }

        setCodes(newCodes); setAnnotations(newAnns);
        if (successCount > 0) {
            setAnnotationHistories(prev => [...prev, { 
                id: crypto.randomUUID(), 
                annotationId: 'system_log', 
                oldRationale: '[SISTEM AI]', 
                newRationale: `Auto-Coding (${autoCodingMode}) memproses ${successCount} segmen pada dokumen "${activeDoc?.title || 'Unknown'}"`, 
                changedAt: new Date().toISOString() 
            }]);
        }
        if (failCount > 0) alert(`Eksekusi selesai: ${successCount} berhasil, ${failCount} gagal.\nError log terakhir: ${lastErrStr}\n(Hasil parsial telah disimpan).`);
        
    } catch(e: any) { alert("Gagal memproses Laju Induktif (Open Coding): " + e.message); }
    setIsAutoCoding(false);
    setCodingProgress(null);
  };

  // --- IPA Auto-Theme Clustering (Axial Coding) ---
  const runAutoTheme = async () => {
    if (codes.length === 0) { alert('Belum ada kode yang diekstraksi. Jalankan Auto-Code (IPA) terlebih dahulu.'); return; }
    setIsAutoTheme(true);
    const codeList = codes.map(c => `- ${c.name}${c.description ? ': ' + c.description : ''}`).join('\n');
    const sysPrompt = promptConfig.autoTheme;
    try {
      const result = await executeLLM(sysPrompt, `Daftar Kode Open Coding yang harus dikelompokkan:\n${codeList}`);
      const jsonStr = result.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (!parsed.themes) throw new Error('Format JSON tidak valid dari model.');

      const newThemes: MacroTheme[] = [];
      const projId = projects.length > 0 ? projects[0].id : 'proj-1';
      let updatedCodes = [...codes];

      parsed.themes.forEach((t: any) => {
        const themeId = crypto.randomUUID();
        newThemes.push({ id: themeId, projectId: projId, name: t.theme_name });
        t.codes.forEach((codeName: string) => {
          const match = updatedCodes.findIndex(c => c.name.toLowerCase() === codeName.toLowerCase());
          if (match !== -1) updatedCodes[match] = { ...updatedCodes[match], themeId };
        });
      });

      setMacroThemes([...macroThemes, ...newThemes]);
      setCodes(updatedCodes);
      alert(`Berhasil membuat ${newThemes.length} tema induk dari ${codes.length} kode.`);
    } catch(e: any) {
      alert('Gagal membuat tema otomatis: ' + e.message);
    }
    setIsAutoTheme(false);
  };

  // --- Manual Annotations ---
  const handleMouseUp = (chunkId: string, chunkContent: string, e: React.MouseEvent) => {
    if (!currentDoc) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) { setSelectionBox(null); return; }

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Walk up from the anchor node to find if we're inside a .text-paragraph
    let node: Node | null = selection.anchorNode;
    let insideParagraph = false;
    while (node) {
      if (node.nodeType === 1 && (node as HTMLElement).classList?.contains('text-paragraph')) {
        insideParagraph = true;
        break;
      }
      node = node.parentNode;
    }
    if (!insideParagraph) return;

    const startOff = chunkContent.indexOf(selectedText);
    if (startOff === -1) return;

    setSelectionBox({ x: e.clientX, y: e.clientY + 10, quote: selectedText, startIndex: startOff, endIndex: startOff + selectedText.length, chunkId });
  };

  const saveManualAction = (existingCodeId?: string) => {
    if (!selectionBox || !currentDoc) return;
    if (!newInitialNoting.trim() && !newCodeName.trim() && !existingCodeId) {
      alert('Isi Initial Nothing atau Kode untuk menyimpan anotasi.');
      return;
    }

    const projId = projects.length > 0 ? projects[0].id : 'proj-1';
    let targetCodeId = existingCodeId;

    if (!targetCodeId && newCodeName.trim()) {
      targetCodeId = crypto.randomUUID();
      setCodes([...codes, { id: targetCodeId, projectId: projId, name: newCodeName.trim(), color: COLORS[codes.length % COLORS.length] }]);
    }
    
    const activeProtocol = projectParameters.find(p => p.isActive);
    
    setAnnotations([...annotations, { 
      id: crypto.randomUUID(), chunkId: selectionBox.chunkId, codeId: targetCodeId, parameterVersionId: activeProtocol?.id || 'orphan', quote: selectionBox.quote, rationale: newInitialNoting.trim(), createdBy: 'MANUAL', startIndex: selectionBox.startIndex, endIndex: selectionBox.endIndex
    }]);
    
    setSelectionBox(null); setNewCodeName(''); setNewInitialNoting(''); setDragPanelOffset({x:0,y:0}); window.getSelection()?.removeAllRanges();
  };

  const removeAnnotation = (id: string, e: React.MouseEvent) => { e.stopPropagation(); setAnnotations(annotations.filter(a => a.id !== id)); };

  const scrollToCode = (codeId: string) => {
    const anns = annotations.filter(a => a.codeId === codeId);
    if (anns.length === 0) return;
    
    // Siklus indeks navigasi jika ada > 1 kutipan
    const currIdx = scrollIndexMap[codeId] || 0;
    const nextIdx = (currIdx + 1) >= anns.length ? 0 : currIdx + 1;
    setScrollIndexMap({...scrollIndexMap, [codeId]: nextIdx});
    
    const targetAnn = anns[nextIdx];
    
    // Gantung/Ubah file tab jika kutipan ternyata berada di dokumen informan lain
    const parentChunk = textChunks.find(c => c.id === targetAnn.chunkId);
    if (parentChunk && parentChunk.documentId !== activeDocId) {
      setActiveDocId(parentChunk.documentId);
    }
    
    // React butuh jeda render (setTimeout) saat berpindah dokumen agar DOM-nya teregristrasi sebelum discroll
    setTimeout(() => {
      const el = document.getElementById(`ann-${targetAnn.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const oldBg = el.style.backgroundColor;
        el.style.backgroundColor = 'rgba(251, 191, 36, 0.8)'; // efek kilat kuning
        setTimeout(() => el.style.backgroundColor = oldBg, 1500);
      }
    }, 150);
  };

  const handleEditCodeName = (codeId: string, oldName: string) => {
    const newName = prompt("Ubah Nama Kode:", oldName);
    if (newName && newName.trim() !== "") setCodes(codes.map(c => c.id === codeId ? {...c, name: newName.trim()} : c));
  };
  const handleEditAnnotationRationale = (annId: string, oldRat: string) => {
    const newRat = prompt("Ubah Rasionalisasi/Catatan Analitis:", oldRat);
    if (newRat !== null && newRat !== oldRat) {
      setAnnotations(annotations.map(a => a.id === annId ? {...a, rationale: newRat} : a));
      setAnnotationHistories(prev => [...prev, { id: crypto.randomUUID(), annotationId: annId, oldRationale: oldRat, newRationale: newRat, changedAt: new Date().toISOString() }]);
    }
  };
  const handleEditThemeName = (themeId: string, oldName: string) => {
    const newName = prompt("Ubah Nama Tema Makro:", oldName);
    if (newName && newName.trim() !== "") setMacroThemes(macroThemes.map(t => t.id === themeId ? {...t, name: newName.trim()} : t));
  };

  const deleteCode = (codeId: string, codeName: string) => {
    if (!confirm(`Hapus kode "${codeName}" dan semua anotasinya secara permanen?`)) return;
    setCodes(codes.filter(c => c.id !== codeId));
    setAnnotations(annotations.filter(a => a.codeId !== codeId));
  };

  const deleteMacroTheme = (themeId: string, themeName: string) => {
    if (!confirm(`Hapus tema "${themeName}"? Kode di dalamnya akan jadi Kode Mandiri.`)) return;
    setMacroThemes(macroThemes.filter(t => t.id !== themeId));
    setCodes(codes.map(c => c.themeId === themeId ? {...c, themeId: undefined} : c));
  };

  // --- Drag and Drop Grouping ---
  const handleDragStart = (e: React.DragEvent, codeId: string) => { e.dataTransfer.setData('codeId', codeId); };
  const handleDropToTheme = (e: React.DragEvent, themeId: string | null) => {
    e.preventDefault();
    const codeId = e.dataTransfer.getData('codeId');
    if (!codeId) return;
    setCodes(codes.map(c => c.id === codeId ? {...c, themeId: themeId || undefined} : c));
  };
  const createNewMacroTheme = () => {
    const name = prompt("Nama Tema Induk baru:");
    if (name) setMacroThemes([...macroThemes, {id: crypto.randomUUID(), projectId: projects.length > 0 ? projects[0].id : 'proj-1', name}]);
  };

  const createNewCode = () => {
    const name = prompt("Nama Kode baru:");
    if (name) setCodes([...codes, {id: crypto.randomUUID(), projectId: projects.length > 0 ? projects[0].id : 'proj-1', name, color: COLORS[codes.length % COLORS.length]}]);
  };

  const sweepOrphanCodes = () => {
    const usedCodeIds = new Set(annotations.map(a => a.codeId));
    const codesToKeep = codes.filter(c => usedCodeIds.has(c.id));
    const unusedCodes = codes.filter(c => !usedCodeIds.has(c.id));

    // Tema dianggap terpakai jika ada KODE TERSISA yang merujuknya
    const usedThemeIds = new Set(codesToKeep.map(c => c.themeId).filter(Boolean));
    const unusedThemes = macroThemes.filter(t => !usedThemeIds.has(t.id));

    if (unusedCodes.length === 0 && unusedThemes.length === 0) {
      alert("Bersih! Tidak ada kode kosong atau tema kosong tanpa anotasi.");
      return;
    }

    let msg = "Ditemukan:\n";
    if (unusedCodes.length > 0) msg += `- ${unusedCodes.length} kode tanpa anotasi\n`;
    if (unusedThemes.length > 0) msg += `- ${unusedThemes.length} tema kosong/tanpa anotasi\n`;
    msg += "\nHapus sekarang?";

    if (confirm(msg)) {
      setCodes(codesToKeep);
      if (unusedThemes.length > 0) {
        setMacroThemes(macroThemes.filter(t => usedThemeIds.has(t.id)));
      }
    }
  };

  // --- Exports ---
  const generateExport = (format: 'matrix' | 'interpretive' | 'refi-qdc', ext: 'csv' | 'md' | 'txt' | 'qdc') => {
    if (format === 'matrix') {
      // Tabel Matriks — Sesuai kolom tab MATRIKS: Dokumen, Tema, Kode, Kutipan, Initial Nothing
      let raw = "DOKUMEN,TEMA INDUK,KODE,KUTIPAN,INITIAL NOTHING,DIBUAT OLEH\n";
      annotations.forEach(a => {
        const cChunk = textChunks.find(tc => tc.id === a.chunkId);
        const fTitle = documents.find(x => x.id === cChunk?.documentId)?.title || 'Unknown';
        const c = codes.find(x => x.id === a.codeId);
        const t = c?.themeId ? macroThemes.find(x => x.id === c.themeId)?.name : '(Mandiri)';
        raw += `"${fTitle}","${t || ''}","${c?.name || 'Catatan Mandiri'}","${a.quote.replace(/"/g, '""')}","${(a.rationale || '').replace(/"/g, '""')}","${a.createdBy}"\n`;
      });
      setExportDraft(raw); setExportType(ext as any); setShowExportModal(true);
    } else if (format === 'interpretive') {
      // Laporan Interpretatif — Hierarki Tema → Kode → Kutipan
      let doc = `# Laporan Analisis Kualitatif Interpretatif\n`;
      doc += `Proyek: ${projects[0]?.name || '-'}\n`;
      doc += `Tanggal: ${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}\n`;
      doc += `Protokol Aktif: ${projectParameters.find(p => p.isActive)?.versionLabel || 'Tidak ada'}\n\n---\n\n`;
      if (draftParameter) doc += `## Fokus Riset\n${draftParameter}\n\n---\n\n`;
      const orphaned = codes.filter(c => !c.themeId);
      macroThemes.forEach(mt => {
        doc += `## TEMA: ${mt.name}\n\n`;
        const children = codes.filter(c => c.themeId === mt.id);
        children.forEach(c => {
          const anns = annotations.filter(a => a.codeId === c.id);
          doc += `### Kode: ${c.name}\n`;
          if (c.description) doc += `> *${c.description}*\n\n`;
          anns.forEach(a => { doc += `- "${a.quote}"\n  *Initial Nothing: ${a.rationale || '-'}* [${a.createdBy}]\n\n`; });
        });
      });
      if (orphaned.length > 0 || annotations.some(a => !a.codeId)) {
        doc += `## KODE MANDIRI DAN CATATAN\n\n`;
        orphaned.forEach(c => {
          doc += `### ${c.name}\n`;
          annotations.filter(a => a.codeId === c.id).forEach(a => doc += `- "${a.quote}"\n  *Initial Nothing: ${a.rationale}*\n\n`);
        });
        const isolatedNotes = annotations.filter(a => !a.codeId);
        if (isolatedNotes.length > 0) {
          doc += `### (Catatan Mandiri tanpa Kode)\n`;
          isolatedNotes.forEach(a => doc += `- "${a.quote}"\n  *Initial Nothing: ${a.rationale}*\n\n`);
        }
      }
      setExportDraft(doc); setExportType(ext as any); setShowExportModal(true);
    } else if (format === 'refi-qdc') {
      let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
      xml += `<CodeBook xmlns="urn:QDA-XML:codebook:1.0" name="${(projects[0]?.name || 'GAK_EROH_Project').replace(/&/g, '&amp;').replace(/</g, '&lt;')}">\n`;
      xml += `  <Codes>\n`;
      macroThemes.forEach(mt => {
        const children = codes.filter(c => c.themeId === mt.id);
        xml += `    <Code name="${mt.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}" guid="${mt.id}" color="#8B5CF6">\n`;
        children.forEach(c => {
          xml += `      <Code name="${c.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}" guid="${c.id}" color="${c.color || '#10b981'}">\n`;
          if (c.description) xml += `        <Description>${c.description.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Description>\n`;
          xml += `      </Code>\n`;
        });
        xml += `    </Code>\n`;
      });
      const orphanedLocal = codes.filter(c => !c.themeId);
      orphanedLocal.forEach(c => {
        xml += `    <Code name="${c.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}" guid="${c.id}" color="${c.color || '#f59e0b'}">\n`;
        if (c.description) xml += `      <Description>${c.description.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Description>\n`;
        xml += `    </Code>\n`;
      });
      xml += `  </Codes>\n</CodeBook>`;
      setExportDraft(xml); setExportType(ext as any); setShowExportModal(true);
    }
  };

  const executeDownload = () => {
    const mime = exportType === 'csv' ? 'text/csv;charset=utf-8' : 
                 (exportType === 'qdc' ? 'application/xml;charset=utf-8' : 'text/plain;charset=utf-8');
    const blob = new Blob([exportDraft], {type: mime});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `gak_eroh_export.${exportType}`; a.click(); setShowExportModal(false);
  };

  // --- Rendering ---
  if (appScreen === 'launcher') {
    return (
      <div style={{minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', backgroundColor:'var(--bg-color)'}}>
        <div style={{display:'flex', flexDirection:'column', gap:'1.5rem', width:'400px', padding:'3rem', borderRadius:'12px', background:'var(--panel-bg)', border:'1px solid var(--border-color)', boxShadow:'0 10px 30px rgba(0,0,0,0.5)'}}>
          <h1 style={{textAlign:'center', fontSize:'1.8rem', letterSpacing:'1px', marginBottom:'1.5rem', color:'var(--text-primary)'}}>GAK <span style={{color:'#3b82f6'}}>EROH</span></h1>
          
          <button className="btn" style={{padding:'1rem', fontSize:'1rem', display:'flex', justifyContent:'center', gap:'0.5rem'}} onClick={() => {
            const name = prompt("Masukkan Nama Proyek Baru (Misal: Skripsi Bab 4):");
            if (!name || name.trim() === '') {
                alert("Pembuatan dibatalkan. Nama proyek wajib diisi.");
                return;
            }
            setProjects([{ id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString() }]);
            setProjectParameters([]); setDocuments([]); setTextChunks([]); setMacroThemes([]); setCodes([]); setAnnotations([]); setAnnotationHistories([]);
            setAppScreen('workspace');
          }}>📄 Ciptakan Proyek Baru</button>

          <label className="btn btn-outline" style={{padding:'1rem', fontSize:'1rem', display:'flex', justifyContent:'center', cursor:'pointer', textAlign:'center', margin:0}}>
            📁 Muat Berkas Eksternal (.qprj)
            <input type="file" accept=".qprj,.json" style={{display:'none'}} onChange={loadProject} />
          </label>

          {savedSessions.length > 0 && (
             <div style={{marginTop:'1.5rem', width:'100%'}}>
               <div style={{fontSize:'0.85rem', color:'var(--text-secondary)', marginBottom:'0.8rem', borderBottom:'1px solid rgba(255,255,255,0.1)', paddingBottom:'0.5rem'}}>Riwayat Proyek Lokal (Auto-Saved)</div>
               <div style={{display:'flex', flexDirection:'column', gap:'0.5rem', maxHeight:'250px', overflowY:'auto', paddingRight:'0.5rem'}}>
                 {savedSessions.map((session, idx) => {
                    const projId = session.projects?.[0]?.id;
                    return (
                    <div key={`${projId ?? 'orphan'}-${idx}`} style={{padding:'1rem', backgroundColor:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:'8px', display:'flex', justifyContent:'space-between', alignItems:'center', transition:'all 0.2s'}}>
                      <div style={{flex:1, minWidth:0, cursor:'pointer'}} onClick={() => {
                        if (session.projects) setProjects(session.projects);
                        if (session.projectParameters) setProjectParameters(session.projectParameters);
                        if (session.documents) setDocuments(session.documents);
                        if (session.textChunks) setTextChunks(session.textChunks);
                        if (session.macroThemes) setMacroThemes(session.macroThemes);
                        if (session.codes) setCodes(session.codes);
                        if (session.annotations) setAnnotations(session.annotations);
                        if (session.annotationHistories) setAnnotationHistories(session.annotationHistories);
                        setAppScreen('workspace');
                      }}>
                        <div style={{fontSize:'0.9rem', fontWeight:'600', color:'var(--text-primary)', marginBottom:'0.2rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{session.projects?.[0]?.name || 'Untitled Project'}</div>
                        <div style={{fontSize:'0.7rem', color:'var(--text-secondary)'}}>{session.documents?.length || 0} Dokumen · {session.annotations?.length || 0} Kutipan · Buka ➔</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); if (!confirm(`Hapus proyek "${session.projects?.[0]?.name || 'ini'}" secara permanen?`)) return; const k = projId || 'latest_session'; deleteFromIDB(k).catch(()=>{}); setSavedSessions(prev => prev.filter((_,i) => i !== idx)); }} style={{marginLeft:'0.8rem', background:'transparent', border:'none', cursor:'pointer', color:'#ef4444', fontSize:'1.1rem', padding:'0.2rem', flexShrink:0}} title="Hapus Proyek">🗑</button>
                    </div>
                    );
                 })}
               </div>
             </div>
          )}
          {/* Reset settings */}
          <div style={{marginTop:'1.5rem', borderTop:'1px solid rgba(255,255,255,0.05)', paddingTop:'1rem', display:'flex', justifyContent:'center'}}>
            <button style={{background:'transparent', border:'none', cursor:'pointer', fontSize:'0.75rem', color:'var(--text-secondary)'}} onClick={() => {
              if (!confirm('Reset semua pengaturan (API Key & Provider) ke default? Data proyek tidak dihapus.')) return;
              localStorage.removeItem('app_apiKey');
              localStorage.removeItem('app_apiProvider');
              setApiKey('');
              setApiProvider('gemini');
            }}>⚙ Reset Pengaturan ke Default</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      {/* SIDEBAR - FILE & THEMES */}
      <div className="panel sidebar" style={{ flex: isLeftOpen ? '0 0 280px' : '0 0 0px', padding: isLeftOpen ? '1.5rem' : '0', opacity: isLeftOpen ? 1 : 0, borderRightWidth: isLeftOpen ? '1px' : '0px' }}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: '2rem'}}>
          <div>
            <div style={{fontSize:'0.65rem', letterSpacing:'1px', color:'var(--text-secondary)', marginBottom:'0.2rem'}}>PROYEK</div>
            <h2 style={{margin:0, fontSize:'1rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'160px'}}>{projects[0]?.name || 'GAK EROH'}</h2>
          </div>
          <div style={{display:'flex', gap:'0.4rem', alignItems:'center'}}>
            <button title="Kembali ke Beranda" className="btn-small btn-outline" style={{fontSize:'0.7rem', padding:'0.2rem 0.5rem'}} onClick={() => {
              if (!confirm('Pergi ke Beranda? Semua progres sudah tersimpan otomatis.')) return;
              setAppScreen('launcher');
              getAllFromIDB().then(sessions => setSavedSessions(sessions.sort((a,b) => {
                const timeA = a.projects?.[0]?.updatedAt ? new Date(a.projects[0].updatedAt).getTime() : (a.projects?.[0]?.createdAt ? new Date(a.projects[0].createdAt).getTime() : 0);
                const timeB = b.projects?.[0]?.updatedAt ? new Date(b.projects[0].updatedAt).getTime() : (b.projects?.[0]?.createdAt ? new Date(b.projects[0].createdAt).getTime() : 0);
                return timeB - timeA;
              }))).catch(()=>{});
            }}>⌂ Beranda</button>
            <button className="btn-small" style={{border:'none', background:'transparent', color:'var(--text-secondary)'}} onClick={() => setIsLeftOpen(false)}>×</button>
          </div>
        </div>
        <div className="file-upload-wrapper">
          <label className="file-label" style={{marginBottom: '0.5rem'}}>+ Transkrip<input type="file" accept=".txt" multiple onChange={handleFileUpload} className="file-input" /></label>
          <div style={{display:'flex', gap:'0.2rem'}}>
            <label className="btn btn-outline btn-small" style={{flex:1, justifyContent:'center'}}>Buka <input type="file" accept=".qprj,.json" onChange={loadProject} className="file-input" /></label>
            <button className="btn btn-outline btn-small" style={{flex:1}} onClick={saveProject}>Simpan</button>
          </div>
        </div>

        <div className="file-list">
          {documents.map(d => {
            const docChunks = textChunks.filter(c => c.documentId === d.id).map(c=>c.id);
            const aCount = annotations.filter(a => docChunks.includes(a.chunkId)).length;
            return (
              <div key={d.id} className={`file-item ${activeDocId === d.id ? 'active' : ''}`} onClick={() => setActiveDocId(d.id)}>
                <span style={{fontSize:'0.85rem', fontWeight: 500, overflow:'hidden', textOverflow:'ellipsis'}}>{d.title}</span>
                <span style={{fontSize:'0.7rem', color:'var(--text-secondary)'}}>{aCount} notes</span>
              </div>
            )
          })}
        </div>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', margin:'2rem 0 0.5rem 0'}}>
          <h3 style={{margin:0}}>Kategorisasi</h3>
          <div style={{display:'flex', gap:'0.4rem'}}>
            <button className="btn-small btn-outline" style={{padding:'0.2rem 0.5rem', border:'none', color:'#f59e0b'}} onClick={sweepOrphanCodes} title="Hapus semua kode yang tidak memiliki anotasi">🧹 Sapu</button>
            <button className="btn-small btn-outline" style={{padding:'0.2rem 0.5rem', border:'none'}} onClick={createNewCode}>+ Kode</button>
            <button className="btn-small btn-outline" style={{padding:'0.2rem 0.5rem', border:'none'}} onClick={createNewMacroTheme}>+ Tema</button>
          </div>
        </div>
        <div style={{fontSize:'0.7rem', color:'var(--text-secondary)', marginBottom:'1rem'}}>
          {codes.length} Kode {codes.length > 0 && `· ${macroThemes.length} Makro`}
        </div>

        <div style={{flex:1, overflowY:'auto'}} onDragOver={e => e.preventDefault()} onDrop={e => handleDropToTheme(e, null)}>
          {macroThemes.map(mt => {
            const mCodes = codes.filter(c => c.themeId === mt.id);
            const isExp = expandedThemes.has(mt.id);
            return (
              <div key={mt.id} style={{marginBottom:'0.4rem', borderRadius:'6px', border:'1px solid rgba(255,255,255,0.07)', overflow:'hidden'}} onDragOver={e => e.preventDefault()} onDrop={e => handleDropToTheme(e, mt.id)}>
                <div style={{padding:'0.5rem 0.7rem', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', backgroundColor: isExp ? 'rgba(255,255,255,0.05)' : 'transparent'}} onClick={() => toggleTheme(mt.id)}>
                  <span style={{fontSize:'0.8rem', fontWeight:600, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{isExp ? '▾' : '▸'} {mt.name}</span>
                  <div style={{display:'flex', alignItems:'center', gap:'0.3rem', flexShrink:0}} onClick={e => e.stopPropagation()}>
                    <span style={{fontSize:'0.65rem', color:'var(--text-secondary)'}}>{mCodes.length}k</span>
                    <span style={{fontSize:'0.7rem', cursor:'pointer', opacity:0.5, padding:'0.1rem 0.3rem'}} title="Edit Nama Tema" onClick={() => handleEditThemeName(mt.id, mt.name)}>✏️</span>
                    <span style={{fontSize:'0.7rem', cursor:'pointer', opacity:0.5, color:'#ef4444', padding:'0.1rem 0.3rem'}} title="Hapus Tema" onClick={() => deleteMacroTheme(mt.id, mt.name)}>🗑</span>
                  </div>
                </div>
                {isExp && (
                  <div style={{padding:'0.4rem 0.6rem 0.6rem', display:'flex', flexWrap:'wrap', gap:'0.3rem', borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                    {mCodes.map(c => (
                      <div key={c.id} draggable onDragStart={e => handleDragStart(e, c.id)} style={{display:'flex', alignItems:'center', gap:'0.2rem'}}>
                        <span className="code-tag" style={{backgroundColor:`${c.color}20`, borderColor:c.color, color:c.color, fontSize:'0.72rem', padding:'0.2rem 0.4rem', cursor:'pointer'}} onClick={() => scrollToCode(c.id)}>{c.name} ({annotations.filter(a => a.codeId === c.id).length}q)</span>
                        <span style={{cursor:'pointer', color:'#ef4444', fontSize:'0.65rem', opacity:0.6, padding:'0.1rem'}} title="Hapus Kode" onClick={e => { e.stopPropagation(); deleteCode(c.id, c.name); }}>×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {codes.filter(c => !c.themeId).length > 0 && (
            <div style={{marginTop:'0.8rem', borderRadius:'6px', border:'1px dashed rgba(255,255,255,0.08)', overflow:'hidden', opacity:0.7}}>
              <div style={{padding:'0.5rem 0.7rem', fontSize:'0.75rem', color:'var(--text-secondary)', fontStyle:'italic'}}>Kode Yatim</div>
              <div style={{padding:'0 0.6rem 0.5rem', display:'flex', flexWrap:'wrap', gap:'0.3rem'}}>
                {codes.filter(c => !c.themeId).map(c => (
                  <div key={c.id} draggable onDragStart={e => handleDragStart(e, c.id)} style={{display:'flex', alignItems:'center', gap:'0.2rem'}}>
                    <span className="code-tag" style={{backgroundColor:`${c.color}20`, borderColor:c.color, color:c.color, fontSize:'0.72rem', padding:'0.2rem 0.4rem', cursor:'pointer'}} onClick={() => scrollToCode(c.id)}>{c.name} ({annotations.filter(a => a.codeId === c.id).length}q)</span>
                    <span style={{cursor:'pointer', color:'#ef4444', fontSize:'0.65rem', opacity:0.6, padding:'0.1rem'}} title="Hapus Kode" onClick={() => deleteCode(c.id, c.name)}>×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{marginTop: '1rem', paddingTop:'1rem', borderTop:'1px solid var(--border-color)'}}>
          <button className="btn btn-outline btn-small" style={{width:'100%'}} onClick={() => setShowExportPickerModal(true)}>⬇ Export</button>
        </div>
      </div>

      {/* CENTER - TEXT VIEWER / TABLE VIEWER */}
      <div className="main-view">
        {!isLeftOpen && <button style={{position:'fixed', top:'1rem', left:'1rem', zIndex:200, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)', color:'var(--text-primary)', border:'1px solid var(--border-color)', borderRadius:'4px', padding:'0.3rem 0.6rem', cursor:'pointer'}} onClick={() => setIsLeftOpen(true)}>☰</button>}
        {!isRightOpen && <button style={{position:'fixed', top:'1rem', right:'1rem', zIndex:200, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)', color:'var(--text-primary)', border:'1px solid var(--border-color)', borderRadius:'4px', padding:'0.3rem 0.6rem', cursor:'pointer'}} onClick={() => setIsRightOpen(true)}>☰</button>}
        
        <div style={{position:'sticky', top:0, zIndex:100, display:'flex', justifyContent:'center', gap:'2rem', fontFamily:'monospace', fontSize:'0.85rem', backgroundColor:'transparent', padding:'1rem 2rem', borderBottom:'1px solid rgba(255,255,255,0.05)', marginLeft:'-2rem', marginRight:'-2rem', marginBottom:'2rem'}}>
           <span onClick={() => setMainViewMode('text')} style={{cursor:'pointer', color: mainViewMode === 'text' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: mainViewMode === 'text' ? '1px solid' : 'none', letterSpacing:'1px', paddingBottom:'0.2rem'}}>NASKAH</span>
           
           <div 
             style={{position:'relative', display:'flex', flexDirection:'column', alignItems:'center'}}
             onMouseEnter={() => setIsHoveringMatriks(true)}
             onMouseLeave={() => setIsHoveringMatriks(false)}
           >
             <span onClick={() => setMainViewMode('table')} style={{cursor:'pointer', color: mainViewMode === 'table' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: mainViewMode === 'table' ? '1px solid' : 'none', letterSpacing:'1px', paddingBottom:'0.2rem'}}>MATRIKS</span>
             
             {isHoveringMatriks && (
               <div className="dropdown-menu">
                  <div className={`dropdown-item ${matrixSubTab === 'code' ? 'active' : ''}`} onClick={() => { setMainViewMode('table'); setMatrixSubTab('code'); }}>KODE</div>
                  <div className={`dropdown-item ${matrixSubTab === 'theme' ? 'active' : ''}`} onClick={() => { setMainViewMode('table'); setMatrixSubTab('theme'); }}>TEMA</div>
               </div>
             )}
           </div>

           <span onClick={() => setMainViewMode('visual')} style={{cursor:'pointer', color: mainViewMode === 'visual' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: mainViewMode === 'visual' ? '1px solid' : 'none', letterSpacing:'1px', paddingBottom:'0.2rem'}}>VISUAL</span>
           <span onClick={() => setMainViewMode('audit')} style={{cursor:'pointer', color: mainViewMode === 'audit' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: mainViewMode === 'audit' ? '1px solid' : 'none', letterSpacing:'1px', paddingBottom:'0.2rem'}}>AUDIT</span>
        </div>

        {mainViewMode === 'audit' ? (
           <div className="text-content-wrapper">
             <h1 style={{fontSize:'1.2rem', marginBottom:'2rem', borderBottom:'1px solid var(--border-color)', paddingBottom:'0.5rem'}}>Riwayat Penyuntingan</h1>
             <div style={{overflowX: 'auto'}}>
               <table style={{width: '100%', borderCollapse: 'collapse', color: 'var(--text-primary)', fontSize: '0.85rem'}}>
                 <thead>
                   <tr style={{textAlign: 'left', color:'var(--text-secondary)', fontSize:'0.75rem', textTransform:'uppercase'}}>
                     <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)'}}>Waktu</th>
                     <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)'}}>Objek Kutipan</th>
                     <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)'}}>Sistem LLM</th>
                     <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)'}}>Revisi Manusia</th>
                   </tr>
                 </thead>
                 <tbody>
                    {annotationHistories.length === 0 ? (
                      <tr><td colSpan={4} style={{textAlign:'center', padding:'2rem', color:'var(--text-secondary)'}}>Sistem belum merekam intervensi penyuntingan rasionalisasi apapun.</td></tr>
                    ) : (
                      annotationHistories.slice().reverse().map(hist => {
                         if (hist.annotationId === 'system_log') {
                           return (
                             <tr key={hist.id} style={{borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor:'rgba(59,130,246,0.05)'}}>
                               <td style={{padding: '1rem', verticalAlign:'top', color:'var(--text-secondary)'}}>{new Date(hist.changedAt).toLocaleString()}</td>
                               <td colSpan={4} style={{padding: '1rem', verticalAlign:'top'}}>
                                 <span style={{color:'#93c5fd', fontWeight:'bold', marginRight:'0.5rem'}}>⚙️ [SISTEM AUTO-CODE]</span>
                                 <span style={{color:'#86efac'}}>{hist.newRationale}</span>
                               </td>
                             </tr>
                           )
                         }

                         const ann = annotations.find(a => a.id === hist.annotationId);
                         const param = projectParameters.find(p => p.id === ann?.parameterVersionId);
                         return (
                            <tr key={hist.id} style={{borderBottom: '1px solid rgba(255,255,255,0.05)', transition:'background 0.2s'}}>
                              <td style={{padding: '1rem', verticalAlign:'top', color:'var(--text-secondary)'}}>
                                {new Date(hist.changedAt).toLocaleString()}
                                {param && <span style={{display:'inline-block', marginTop:'0.4rem', fontSize:'0.65rem', backgroundColor:'rgba(59, 130, 246, 0.4)', color:'#93c5fd', border:'1px solid #3b82f6', padding:'0.2rem 0.4rem', borderRadius:'4px', cursor:'pointer'}} onClick={() => { setActiveTab('autocode'); setViewingProtocolId(param.id); setIsRightOpen(true); }} title="Lihat Protokol saat itu">👁️ {param.versionLabel}</span>}
                              </td>
                              <td style={{padding: '1rem', verticalAlign:'top', fontStyle:'italic', maxWidth:'250px'}}>{ann?.quote || '[Data Anotasi Dihapus]'}</td>
                              <td style={{padding: '1rem', verticalAlign:'top', maxWidth:'250px', color:'#fca5a5'}}>{hist.oldRationale}</td>
                              <td style={{padding: '1rem', verticalAlign:'top', maxWidth:'250px', color:'#86efac'}}>{hist.newRationale}</td>
                            </tr>
                         )
                      })
                    )}
                 </tbody>
               </table>
             </div>
           </div>
        ) : mainViewMode === 'visual' ? (
           <div className="text-content-wrapper" style={{display:'flex', flexDirection:'column', gap:'2rem'}}>
             {/* Word Cloud / Frequency */}
             <div style={{backgroundColor:'rgba(255,255,255,0.02)', padding:'1.5rem', borderRadius:'12px', border:'1px solid rgba(255,255,255,0.05)'}}>
               <h3 style={{marginTop:0, marginBottom:'1rem', color:'#93c5fd', display:'flex', alignItems:'center', gap:'0.5rem'}}>📊 Top 15 Kata Tersering (Grounded Frequency)</h3>
               {frequentWords.length > 0 ? (
                 <div style={{display:'flex', flexWrap:'wrap', gap:'0.8rem'}}>
                   {frequentWords.map(([w, c], i) => (
                     <div key={w} style={{backgroundColor:`rgba(59,130,246,${Math.max(0.1, 0.4 - i*0.02)})`, padding:'0.4rem 0.8rem', borderRadius:'8px', border:'1px solid rgba(59,130,246,0.3)', display:'flex', alignItems:'center', gap:'0.5rem'}}>
                       <span style={{fontSize: `${Math.max(0.8, 1.2 - i*0.03)}rem`, fontWeight: i < 5 ? 'bold' : 'normal', color: i < 5 ? '#fff' : '#c4b5fd'}}>{w.toUpperCase()}</span>
                       <span style={{backgroundColor:'rgba(0,0,0,0.3)', padding:'0.1rem 0.4rem', borderRadius:'4px', fontSize:'0.7rem', color:'#93c5fd'}}>{c}x</span>
                     </div>
                   ))}
                 </div>
               ) : (
                 <div style={{color:'var(--text-secondary)'}}>Belum ada data teks.</div>
               )}
             </div>

             {/* Thematic Tree */}
             <div style={{backgroundColor:'rgba(255,255,255,0.02)', padding:'1.5rem', borderRadius:'12px', border:'1px solid rgba(255,255,255,0.05)', overflowX:'auto'}}>
               <h3 style={{marginTop:0, marginBottom:'1.5rem', color:'#c4b5fd', display:'flex', alignItems:'center', gap:'0.5rem'}}>🗂️ Peta Hierarki Tema & Kode</h3>
               
               <div style={{display:'flex', gap:'2rem', minWidth:'max-content'}}>
                 {macroThemes.length === 0 && codes.length === 0 && <span style={{color:'var(--text-secondary)'}}>Belum ada tema atau kode untuk divisualisasikan.</span>}
                 
                 {macroThemes.map(mt => {
                   const mCodes = codes.filter(c => c.themeId === mt.id);
                   return (
                     <div key={mt.id} style={{display:'flex', flexDirection:'column', alignItems:'center', minWidth:'220px'}}>
                       <div style={{backgroundColor:'rgba(139,92,246,0.15)', border:'2px solid rgba(139,92,246,0.5)', padding:'0.8rem 1.5rem', borderRadius:'8px', fontWeight:'bold', color:'#e9d5ff', textAlign:'center', marginBottom:'1.5rem', boxShadow:'0 4px 12px rgba(0,0,0,0.2)'}}>
                         {mt.name}
                       </div>
                       
                       <div style={{width:'2px', height:'10px', backgroundColor:'rgba(139,92,246,0.3)', marginTop:'-1.5rem'}}></div>
                       
                       <div style={{display:'flex', flexDirection:'column', gap:'1rem', width:'100%', position:'relative'}}>
                          {mCodes.map((c, i) => {
                            const cAnnCount = annotations.filter(a => a.codeId === c.id).length;
                            return (
                              <div key={c.id} style={{display:'flex', alignItems:'center', position:'relative'}}>
                                {/* Konekting line kiri */}
                                <div style={{width:'15px', height:'2px', backgroundColor:'rgba(139,92,246,0.3)', position:'absolute', left:'-15px'}}></div>
                                {/* Node kode */}
                                <div style={{width:'100%', backgroundColor:'rgba(255,255,255,0.05)', border:`1px solid ${c.color || '#555'}`, borderLeft:`4px solid ${c.color || '#555'}`, padding:'0.6rem 1rem', borderRadius:'6px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                  <span style={{fontSize:'0.85rem'}} title={c.description || ''}>{c.name}</span>
                                  {cAnnCount > 0 && <span style={{fontSize:'0.65rem', backgroundColor:'rgba(0,0,0,0.3)', padding:'0.2rem 0.4rem', borderRadius:'4px', color:'var(--text-secondary)'}} title="Frekuensi Grounded">{cAnnCount} quote</span>}
                                </div>
                              </div>
                            )
                          })}
                          
                          {/* Garis vertikal utama yang menyambung anak-anak ke tema induk */}
                          {mCodes.length > 0 && <div style={{width:'2px', height:'calc(100% - 20px)', backgroundColor:'rgba(139,92,246,0.3)', position:'absolute', left:'-15px', top:'20px'}}></div>}
                       </div>
                     </div>
                   )
                 })}

                 {/* Klaster Orphan */}
                 {codes.filter(c => !c.themeId).length > 0 && (
                     <div style={{display:'flex', flexDirection:'column', alignItems:'center', minWidth:'220px', marginLeft:'2rem', borderLeft:'1px dashed rgba(255,255,255,0.1)', paddingLeft:'2rem'}}>
                       <div style={{backgroundColor:'rgba(245,158,11,0.1)', border:'2px dashed rgba(245,158,11,0.5)', padding:'0.8rem 1.5rem', borderRadius:'8px', fontWeight:'bold', color:'#fde68a', textAlign:'center', marginBottom:'1.5rem'}}>
                         Kode Belum Dikategorikan
                       </div>
                       <div style={{display:'flex', flexDirection:'column', gap:'0.8rem', width:'100%'}}>
                          {codes.filter(c => !c.themeId).map(c => {
                             const cAnnCount = annotations.filter(a => a.codeId === c.id).length;
                             return (
                                <div key={c.id} style={{backgroundColor:'rgba(255,255,255,0.03)', border:`1px solid ${c.color || '#555'}`, padding:'0.5rem 0.8rem', borderRadius:'6px', display:'flex', justifyContent:'space-between', alignItems:'center', opacity:0.8}}>
                                  <span style={{fontSize:'0.8rem'}} title={c.description || ''}>{c.name}</span>
                                  {cAnnCount > 0 && <span style={{fontSize:'0.65rem', backgroundColor:'rgba(0,0,0,0.3)', padding:'0.2rem 0.4rem', borderRadius:'4px', color:'var(--text-secondary)'}}>{cAnnCount} quote</span>}
                                </div>
                             )
                          })}
                       </div>
                     </div>
                 )}
               </div>

             </div>
           </div>
        ) : mainViewMode === 'table' ? (
           <div className="matrix-wrapper">
             {/* Sub-tab Nav moved to header */}

             {matrixSubTab === 'code' ? (
               <div style={{overflowX: 'auto'}}>
                 <table className="fixed-table" style={{borderCollapse: 'collapse', color: 'var(--text-primary)', fontSize: '0.85rem'}}>
                   <thead>
                     <tr style={{textAlign: 'left', color:'var(--text-secondary)', fontSize:'0.75rem', textTransform:'uppercase'}}>
                       <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)', width: matrixColWidths['c_doc']}}>
                         Dokumen
                         <div className="resize-handle" onMouseDown={(e) => {
                           e.preventDefault();
                           const move = handleColumnResize('c_doc', e.clientX, matrixColWidths['c_doc']);
                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                         }}/>
                       </th>
                       <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)', width: matrixColWidths['c_theme']}}>
                         Tema
                         <div className="resize-handle" onMouseDown={(e) => {
                           e.preventDefault();
                           const move = handleColumnResize('c_theme', e.clientX, matrixColWidths['c_theme']);
                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                         }}/>
                       </th>
                       <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)', width: matrixColWidths['c_code']}}>
                         Kode
                         <div className="resize-handle" onMouseDown={(e) => {
                           e.preventDefault();
                           const move = handleColumnResize('c_code', e.clientX, matrixColWidths['c_code']);
                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                         }}/>
                       </th>
                       <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)', width: matrixColWidths['c_quote']}}>
                         Kutipan
                         <div className="resize-handle" onMouseDown={(e) => {
                           e.preventDefault();
                           const move = handleColumnResize('c_quote', e.clientX, matrixColWidths['c_quote']);
                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                         }}/>
                       </th>
                       <th style={{padding: '1rem', borderBottom: '1px solid var(--border-color)', width: matrixColWidths['c_rat']}}>
                         Initial Nothing
                         <div className="resize-handle" onMouseDown={(e) => {
                           e.preventDefault();
                           const move = handleColumnResize('c_rat', e.clientX, matrixColWidths['c_rat']);
                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                         }}/>
                       </th>
                     </tr>
                   </thead>
                   <tbody>
                     {annotations.length === 0 ? (
                       <tr><td colSpan={5} style={{textAlign:'center', padding:'2rem', color:'var(--text-secondary)'}}>Belum ada data koding yang direkam.</td></tr>
                     ) : (
                       annotations.map(ann => {
                         const chunk = textChunks.find(c => c.id === ann.chunkId);
                         const fTitle = documents.find(x => x.id === chunk?.documentId)?.title || 'Unknown';
                         const c = codes.find(x => x.id === ann.codeId);
                         const t = c?.themeId ? macroThemes.find(x => x.id === c.themeId)?.name : '- (Mandiri) -';
                         const param = projectParameters.find(p => p.id === ann.parameterVersionId);
                         return (
                           <tr key={ann.id} style={{borderBottom: '1px solid rgba(255,255,255,0.05)', transition:'background 0.2s'}}>
                             <td style={{padding: '1rem', verticalAlign:'top', color:'var(--text-secondary)'}}>
                               {fTitle} (C{chunk?.sequenceNum})
                               {param && <span style={{display:'inline-block', marginTop:'0.4rem', fontSize:'0.65rem', backgroundColor:'rgba(59, 130, 246, 0.4)', color:'#93c5fd', border:'1px solid #3b82f6', padding:'0.2rem 0.4rem', borderRadius:'4px', cursor:'pointer'}} onClick={() => { setActiveTab('autocode'); setViewingProtocolId(param.id); setIsRightOpen(true); }} title="Lihat Protokol saat itu">👁️ {param.versionLabel}</span>}
                             </td>
                             <td style={{padding: '1rem', verticalAlign:'top', fontWeight:600}}>
                               {t}
                               {c?.themeId && <span style={{marginLeft:'0.4rem', cursor:'pointer', fontSize:'0.75rem', opacity:0.5}} title="Edit Nama Tema" onClick={()=>handleEditThemeName(c.themeId!, t!)}>✏️</span>}
                             </td>
                             <td style={{padding: '1rem', verticalAlign:'top'}}>
                               <div style={{display:'flex', alignItems:'flex-start', gap:'0.4rem'}}>
                                 <span className="code-tag" style={{backgroundColor: `${c?.color || '#9ca3af'}20`, borderColor: c?.color || '#9ca3af', color: c?.color || '#9ca3af', padding:'0.4rem', whiteSpace:'normal'}}>{c?.name || 'Catatan Mandiri'}</span>
                                 {c && <span style={{cursor:'pointer', fontSize:'0.75rem', opacity:0.5}} title="Edit Nama Kode" onClick={()=>handleEditCodeName(c.id, c.name)}>✏️</span>}
                               </div>
                             </td>
                             <td style={{padding: '1rem', verticalAlign:'top', fontStyle:'italic', maxWidth:'300px', lineHeight:'1.5'}}>{ann.quote}</td>
                             <td style={{padding: '1rem', verticalAlign:'top', maxWidth:'300px', lineHeight:'1.5'}}>
                               {ann.rationale || '-'}
                               <span style={{marginLeft:'0.4rem', cursor:'pointer', fontSize:'0.75rem', opacity:0.5}} title="Edit Initial Nothing" onClick={()=>handleEditAnnotationRationale(ann.id, ann.rationale)}>✏️</span>
                               {annotationHistories.some(h => h.annotationId === ann.id) && <span style={{display:'block', fontSize:'0.6rem', marginTop:'0.5rem', color:'#f59e0b'}}>[Diedit Manual]</span>}
                             </td>
                           </tr>
                         );
                       })
                     )}
                   </tbody>
                 </table>
               </div>
             ) : (
               /* TEMA sub-tab — Accordion per Tema */
               <div style={{display:'flex', flexDirection:'column', gap:'0.8rem'}}>
                 {macroThemes.length === 0 && codes.filter(c => !c.themeId).length === 0 ? (
                   <div style={{textAlign:'center', padding:'3rem', color:'var(--text-secondary)'}}>Belum ada tema. Jalankan Auto-Tema atau buat manual.</div>
                 ) : (
                   <>
                     {macroThemes.map(mt => {
                       const themeCodes = codes.filter(c => c.themeId === mt.id);
                       const themeAnns = annotations.filter(a => themeCodes.some(c => c.id === a.codeId));
                       const isExp = expandedThemes.has(`matrix-${mt.id}`);
                       return (
                         <div key={mt.id} style={{border:'1px solid rgba(255,255,255,0.08)', borderRadius:'10px', position:'relative', marginBottom:'1.5rem'}}>
                           {/* CONTAINER HEADER & PILLS (Sticky untuk Pin Kode) */}
                           <div style={{position:'sticky', top:'48px', zIndex:150, backgroundColor:'rgba(10,10,10,0.98)', backdropFilter:'blur(10px)', borderBottom: isExp ? '1px solid rgba(255,255,255,0.1)' : 'none', borderTopLeftRadius:'10px', borderTopRightRadius:'10px'}}>
                             <div style={{padding:'1rem 1.2rem', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', backgroundColor: isExp ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)', transition:'background 0.2s'}} onClick={() => toggleTheme(`matrix-${mt.id}`)}>
                               <div style={{display:'flex', alignItems:'center', gap:'0.8rem'}}>
                                 <span style={{fontSize:'0.9rem', color:'var(--text-secondary)'}}>{isExp ? '▾' : '▸'}</span>
                                 <span style={{fontWeight:'700', fontSize:'1rem'}}>{mt.name}</span>
                               </div>
                               <div style={{display:'flex', gap:'1rem', fontSize:'0.7rem', color:'var(--text-secondary)', alignItems:'center'}}>
                                 <span>{themeCodes.length} kode</span>
                                 <span>{themeAnns.length} kutipan</span>
                                 <span style={{cursor:'pointer', opacity:0.6}} onClick={e => { e.stopPropagation(); handleEditThemeName(mt.id, mt.name); }}>✏️</span>
                               </div>
                             </div>

                             {/* Kode pills — kini selalu terlihat */}
                             {themeCodes.length > 0 && (
                               <div style={{padding:'0.5rem 1.2rem 0.8rem', display:'flex', flexWrap:'wrap', gap:'0.3rem', borderTop:'1px solid rgba(255,255,255,0.04)'}}>
                                 {themeCodes.map(c => (
                                   <span key={c.id} className="code-tag" style={{backgroundColor:`${c.color}20`, borderColor:c.color, color:c.color, fontSize:'0.72rem', padding:'0.2rem 0.5rem'}}>{c.name} ({annotations.filter(a => a.codeId === c.id).length}q)</span>
                                 ))}
                               </div>
                             )}
                           </div>

                           {/* Expanded: tabel kode + kutipan + panel Interpretasi secara kolom flex resizable */}
                           {isExp && (
                             <div style={{display:'flex', flexDirection:'row', width:'100%'}}>
                               {/* Tabel Kode & Kutipan (Kolom Kiri) */}
                               <div style={{width: `${themeAnns.length > 0 ? matrixSplitRatio : 100}%`, overflowX:'auto'}}>
                                 <table className="fixed-table" style={{borderCollapse:'collapse', fontSize:'0.83rem', color:'var(--text-primary)'}}>
                                   <thead>
                                     <tr style={{textAlign:'left', color:'var(--text-secondary)', fontSize:'0.7rem', textTransform:'uppercase', backgroundColor:'rgba(255,255,255,0.01)'}}>
                                       <th style={{padding:'0.6rem 1rem', borderBottom:'1px solid rgba(255,255,255,0.05)', width: matrixColWidths['t_code']}}>
                                         Kode
                                         <div className="resize-handle" onMouseDown={(e) => {
                                           e.preventDefault();
                                           const move = handleColumnResize('t_code', e.clientX, matrixColWidths['t_code']);
                                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                                         }}/>
                                       </th>
                                       <th style={{padding:'0.6rem 1rem', borderBottom:'1px solid rgba(255,255,255,0.05)', width: matrixColWidths['t_doc']}}>
                                         Dokumen
                                         <div className="resize-handle" onMouseDown={(e) => {
                                           e.preventDefault();
                                           const move = handleColumnResize('t_doc', e.clientX, matrixColWidths['t_doc']);
                                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                                         }}/>
                                       </th>
                                       <th style={{padding:'0.6rem 1rem', borderBottom:'1px solid rgba(255,255,255,0.05)', width: matrixColWidths['t_quote']}}>
                                         Kutipan
                                         <div className="resize-handle" onMouseDown={(e) => {
                                           e.preventDefault();
                                           const move = handleColumnResize('t_quote', e.clientX, matrixColWidths['t_quote']);
                                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                                         }}/>
                                       </th>
                                       <th style={{padding:'0.6rem 1rem', borderBottom:'1px solid rgba(255,255,255,0.05)', width: matrixColWidths['t_rat']}}>
                                         Initial Nothing
                                         <div className="resize-handle" onMouseDown={(e) => {
                                           e.preventDefault();
                                           const move = handleColumnResize('t_rat', e.clientX, matrixColWidths['t_rat']);
                                           const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                                           window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                                         }}/>
                                       </th>
                                     </tr>
                                   </thead>
                                   <tbody>
                                     {themeAnns.length === 0 ? (
                                       <tr><td colSpan={4} style={{padding:'1rem', color:'var(--text-secondary)', fontStyle:'italic'}}>Belum ada kutipan.</td></tr>
                                     ) : themeAnns.map(ann => {
                                       const c = codes.find(x => x.id === ann.codeId);
                                       const chunk = textChunks.find(x => x.id === ann.chunkId);
                                       const doc = documents.find(x => x.id === chunk?.documentId);
                                       return (
                                         <tr key={ann.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                                           <td style={{padding:'0.6rem 1rem', verticalAlign:'top'}}>
                                             <span className="code-tag" style={{backgroundColor:`${c?.color}20`, borderColor:c?.color, color:c?.color, padding:'0.2rem 0.45rem', fontSize:'0.78rem'}}>{c?.name}</span>
                                           </td>
                                           <td style={{padding:'0.6rem 1rem', verticalAlign:'top', color:'var(--text-secondary)', fontSize:'0.78rem', whiteSpace:'nowrap'}}>{doc?.title || '-'}</td>
                                           <td style={{padding:'0.6rem 1rem', verticalAlign:'top', fontStyle:'italic', maxWidth:'260px', lineHeight:'1.5'}}>{ann.quote}</td>
                                           <td style={{padding:'0.6rem 1rem', verticalAlign:'top', maxWidth:'240px', lineHeight:'1.5'}}>
                                             {ann.rationale || '-'}
                                             <span style={{marginLeft:'0.3rem', cursor:'pointer', fontSize:'0.7rem', opacity:0.4}} onClick={() => handleEditAnnotationRationale(ann.id, ann.rationale)}>✏️</span>
                                           </td>
                                         </tr>
                                       );
                                     })}
                                   </tbody>
                                 </table>
                               </div>

                               {/* Resizer Handle */}
                               {themeAnns.length > 0 && (
                                 <div style={{width:'4px', backgroundColor:'rgba(139,92,246,0.2)', cursor:'col-resize', flexShrink:0, transition:'background 0.2s'}}
                                      onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'rgba(139,92,246,0.6)')}
                                      onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'rgba(139,92,246,0.2)')}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        const startX = e.clientX;
                                        const startRatio = matrixSplitRatio;
                                        const move = (me: MouseEvent) => {
                                           const delta = (me.clientX - startX) / (window.innerWidth - 60) * 100;
                                           let nr = startRatio + delta;
                                           if (nr < 25) nr = 25;
                                           if (nr > 85) nr = 85;
                                           setMatrixSplitRatio(nr);
                                        };
                                        const up = () => {
                                           window.removeEventListener('mousemove', move);
                                           window.removeEventListener('mouseup', up);
                                        };
                                        window.addEventListener('mousemove', move);
                                        window.addEventListener('mouseup', up);
                                      }}
                                 />
                               )}

                               {/* Kolom INTERPRETASI Tema Keseluruhan (Kolom Kanan) */}
                               {themeAnns.length > 0 && (
                                 <div className="interpretation-panel" style={{width: `calc(${100 - matrixSplitRatio}% - 4px)`, backgroundColor:'rgba(139,92,246,0.04)', padding:'1.2rem', overflowX:'auto'}}>
                                   <div style={{fontSize:'0.7rem', letterSpacing:'1px', color:'#c4b5fd', fontWeight:'700', textTransform:'uppercase', marginBottom:'1rem', borderBottom:'1px solid rgba(139,92,246,0.2)', paddingBottom:'0.4rem', display:'flex', alignItems:'center', gap:'0.4rem'}}>
                                     <span>💡</span> Interpretasi Tema
                                   </div>
                                   <div style={{color:'#e2d9f3', lineHeight:'1.7', fontSize:'0.82rem', paddingRight:'2.5rem'}}>
                                     {(() => {
                                       const allRationales = themeAnns.map(a => a.rationale).filter(Boolean);
                                       if (allRationales.length === 0) return <span style={{color:'var(--text-secondary)', fontStyle:'italic'}}>Belum ada initial nothing untuk disintesis pada tema ini.</span>;
                                       return allRationales.map((rat, i) => (
                                         <div key={i} style={{marginBottom:'0.8rem', paddingLeft:'0.8rem', borderLeft:'2px solid rgba(139,92,246,0.4)', textAlign:'justify'}}>
                                           {rat}
                                         </div>
                                       ));
                                     })()}
                                   </div>
                                 </div>
                               )}
                             </div>
                           )}
                         </div>
                       );
                     })}

                     {/* Kode Mandiri */}
                     {codes.filter(c => !c.themeId).length > 0 && (
                       <div style={{border:'1px dashed rgba(255,255,255,0.08)', borderRadius:'10px', overflow:'hidden', opacity:0.65}}>
                         <div style={{padding:'0.8rem 1.2rem', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer'}} onClick={() => toggleTheme('matrix-orphan')}>
                           <span style={{fontSize:'0.85rem', fontWeight:'600', color:'var(--text-secondary)'}}>{expandedThemes.has('matrix-orphan') ? '▾' : '▸'} Kode Mandiri & Catatan</span>
                           <span style={{fontSize:'0.7rem', color:'var(--text-secondary)'}}>{codes.filter(c => !c.themeId).length} kode</span>
                         </div>
                         {expandedThemes.has('matrix-orphan') && (
                           <div style={{overflowX:'auto', borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                             <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.83rem'}}>
                               <thead>
                                 <tr style={{textAlign:'left', color:'var(--text-secondary)', fontSize:'0.7rem', textTransform:'uppercase'}}>
                                   <th style={{padding:'0.6rem 1rem', borderBottom:'1px solid rgba(255,255,255,0.05)'}}>Kode</th>
                                   <th style={{padding:'0.6rem 1rem', borderBottom:'1px solid rgba(255,255,255,0.05)'}}>Kutipan</th>
                                   <th style={{padding:'0.6rem 1rem', borderBottom:'1px solid rgba(255,255,255,0.05)'}}>Initial Nothing</th>
                                 </tr>
                               </thead>
                               <tbody>
                                 {annotations.filter(a => !a.codeId || codes.find(c => c.id === a.codeId && !c.themeId)).map(ann => {
                                   const c = codes.find(x => x.id === ann.codeId);
                                   return (
                                     <tr key={ann.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                                       <td style={{padding:'0.6rem 1rem', verticalAlign:'top'}}><span className="code-tag" style={{backgroundColor:`${c?.color || '#9ca3af'}20`, borderColor:c?.color || '#9ca3af', color:c?.color || '#9ca3af', padding:'0.2rem 0.45rem', fontSize:'0.78rem'}}>{c?.name || 'Catatan Mandiri'}</span></td>
                                       <td style={{padding:'0.6rem 1rem', verticalAlign:'top', fontStyle:'italic', maxWidth:'280px', lineHeight:'1.5'}}>{ann.quote}</td>
                                       <td style={{padding:'0.6rem 1rem', verticalAlign:'top', maxWidth:'240px', lineHeight:'1.5'}}>{ann.rationale || '-'}</td>
                                     </tr>
                                   );
                                 })}
                               </tbody>
                             </table>
                           </div>
                         )}
                       </div>
                     )}
                   </>
                 )}
               </div>
             )}
           </div>
        ) : currentDoc ? (
          <div className="text-content-wrapper">
             <h1>{currentDoc.title}</h1>
             <hr style={{borderColor:'var(--border-color)', margin:'1rem 0'}}/>
             {textChunks.filter(c => c.documentId === currentDoc.id).sort((a,b)=>a.sequenceNum - b.sequenceNum).map((chunk) => {
               let renderElements = [];
               const cAnns = annotations.filter(a => a.chunkId === chunk.id).sort((a,b) => a.startIndex - b.startIndex);
               if (cAnns.length === 0) { renderElements.push(<span key="full">{chunk.content}</span>); }
               else {
                 let lastIdx = 0;
                 cAnns.forEach((ann, idx) => {
                   if (ann.startIndex > lastIdx) renderElements.push(<span key={`text-${idx}`}>{chunk.content.substring(lastIdx, ann.startIndex)}</span>);
                   const code = codes.find(c => c.id === ann.codeId);
                   renderElements.push(
                     <span key={`ann-${ann.id}`} id={`ann-${ann.id}`} className="highlighted-segment" style={{backgroundColor: `${code?.color || '#9ca3af'}40`, borderBottomColor: code?.color || '#9ca3af'}}>
                       {chunk.content.substring(ann.startIndex, ann.endIndex)}
                       <sup style={{backgroundColor: code?.color || '#9ca3af', color:'white', padding:'0.1rem 0.3rem', borderRadius:'4px', cursor:'pointer', marginLeft:'4px', fontSize:'0.65rem'}} onClick={(e) => removeAnnotation(ann.id, e)} title="Hapus [{ann.createdBy}]">[{ann.createdBy[0]}] {code?.name || 'Catatan'}</sup>
                     </span>
                   );
                   lastIdx = ann.endIndex;
                 });
                 if (lastIdx < chunk.content.length) renderElements.push(<span key={`end`}>{chunk.content.substring(lastIdx)}</span>);
               }
               return <div key={chunk.id} className="text-paragraph" style={{whiteSpace:'pre-wrap', marginBottom:'1.5rem'}} onMouseUp={(e) => handleMouseUp(chunk.id, chunk.content, e)}>{renderElements}</div>
             })}
          </div>
        ) : (
          <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)'}}>
             Silakan + Tambah Dokumen atau Buka Proyek untuk memulai analisis.
          </div>
        )}
        
        {/* Annotation Panel — Draggable */}
        {selectionBox && (
          <div
            className="context-menu"
            style={{
              position: 'fixed',
              left: selectionBox.x + dragPanelOffset.x,
              top: selectionBox.y + dragPanelOffset.y,
              width: '320px',
              padding: '0',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 9999,
              userSelect: 'none',
            }}
          >
            {/* Drag Handle / Header */}
            <div
              style={{
                padding: '0.6rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'grab',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px 8px 0 0',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX - dragPanelOffset.x;
                const startY = e.clientY - dragPanelOffset.y;
                const onMove = (me: MouseEvent) => {
                  setDragPanelOffset({ x: me.clientX - startX, y: me.clientY - startY });
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>⠿ Anotasi Manual</span>
              <button
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem', padding: '0' }}
                onClick={() => { setSelectionBox(null); setNewCodeName(''); setNewInitialNoting(''); setDragPanelOffset({x:0,y:0}); window.getSelection()?.removeAllRanges(); }}
              >✕</button>
            </div>

            {/* Panel Body */}
            <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {/* Preview kutipan */}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', backgroundColor: 'rgba(255,255,255,0.03)', padding: '0.5rem', borderRadius: '4px', maxHeight: '60px', overflowY: 'auto', lineHeight: '1.5' }}>
                &ldquo;{selectionBox.quote}&rdquo;
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-primary)', display: 'block', marginBottom: '0.3rem' }}>1. Initial Nothing (Opsional):</label>
                <textarea
                  className="input-field"
                  autoFocus
                  style={{ width: '100%', minHeight: '70px', padding: '0.5rem', fontSize: '0.8rem', resize: 'vertical' }}
                  placeholder="Tuliskan catatan analitik/interpretif..."
                  value={newInitialNoting}
                  onChange={e => setNewInitialNoting(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-primary)', display: 'block', marginBottom: '0.3rem' }}>2. Kode Baru (Opsional):</label>
                <input
                  type="text"
                  className="input-field"
                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem' }}
                  placeholder="Nama kode..."
                  value={newCodeName}
                  onChange={e => setNewCodeName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveManualAction()}
                />
              </div>

              <button className="btn" style={{ width: '100%', padding: '0.6rem' }} onClick={() => saveManualAction()}>
                💾 Simpan Anotasi
              </button>

              {codes.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.8rem' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>3. Atau tag dengan Kode terdahulu:</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxHeight: '100px', overflowY: 'auto' }}>
                    {codes.map(c => (
                      <span key={c.id} className="code-tag" style={{ backgroundColor: c.color, fontSize: '0.75rem', padding: '0.3rem 0.6rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)' }} onClick={() => saveManualAction(c.id)}>{c.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT SIDEBAR - AI ENGINE */}
      <div className="panel ai-panel" style={{ flex: isRightOpen ? '0 0 320px' : '0 0 0px', padding: isRightOpen ? '1.5rem' : '0', opacity: isRightOpen ? 1 : 0, borderLeftWidth: isRightOpen ? '1px' : '0px' }}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem'}}>
          <h2 style={{margin:0}}>Asisten</h2>
          <button className="btn-small" style={{border:'none', background:'transparent', color:'var(--text-secondary)'}} onClick={() => setIsRightOpen(false)}>×</button>
        </div>
        
        <h3 style={{marginBottom:'0.5rem'}}>API</h3>
        <select className="input-field" style={{marginBottom: '1rem', padding: '0.5rem'}} value={apiProvider} onChange={e => handleProviderChange(e.target.value)}>
          <option value="gemini">Gemini (Direkomendasikan)</option><option value="openai">OpenAI</option><option value="groq">Groq Llama</option>
        </select>

        <h3 style={{marginTop:'1.5rem', marginBottom:'0.5rem'}}>Sandigate</h3>
        <div style={{display:'flex', flexDirection:'column', gap:'0.3rem', marginBottom:'2rem'}}>
           <input type="password" className="input-field" style={{padding: '0.5rem', fontSize: '0.85rem'}} placeholder="Masukkan 1 API Key di sini..." value={apiKey} onChange={e => updateKey(e.target.value)} />
           <button className="btn btn-outline" style={{padding:'0.4rem', fontSize:'0.75rem', marginTop:'0.5rem'}} onClick={() => { setPromptDraft(promptConfig[editingPromptKey] as string); setShowPromptModal(true); }}>⚙️ Pengaturan Prompt AI</button>
        </div>

        <div className="tabs-header">
           <button className={`tab-btn ${activeTab==='autocode'?'active':''}`} onClick={()=>setActiveTab('autocode')}>Auto-Code (IPA)</button>
           <button className={`tab-btn ${activeTab==='chat'?'active':''}`} onClick={()=>setActiveTab('chat')}>Q&A Chat</button>
        </div>

        {activeTab === 'autocode' && (
           <div className="tab-content" style={{gap:'1rem'}}>

              {/* Live Coding Progress Panel */}
              {isAutoCoding && codingProgress && (
                <div style={{
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.35)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.7rem',
                  marginBottom: '0.5rem',
                }}>
                  {/* Header progress */}
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <span style={{fontSize:'0.7rem', letterSpacing:'1px', color:'#93c5fd', fontWeight:'700', textTransform:'uppercase'}}>
                      ⚡ Sedang Mengkode...
                    </span>
                    <span style={{fontSize:'0.7rem', color:'var(--text-secondary)', fontWeight:'600'}}>
                      {Math.round(((codingProgress.chunkIdx - 1) / codingProgress.total) * 100)}% (Segmen {codingProgress.chunkIdx}/{codingProgress.total})
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div style={{height:'4px', backgroundColor:'rgba(255,255,255,0.08)', borderRadius:'999px', overflow:'hidden', position:'relative'}}>
                    <div style={{
                      height:'100%',
                      width: `${Math.max(5, Math.round(((codingProgress.chunkIdx - 1) / codingProgress.total) * 100))}%`,
                      background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                      borderRadius: '999px',
                      transition: 'width 0.4s ease',
                    }}/>
                    <div style={{
                      position: 'absolute', top:0, left:0, height:'100%', width:'100%', 
                      background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                      animation: 'shimmer 1.5s infinite'
                    }} />
                  </div>

                  {/* Countdown jeda rate limit */}
                  {codingProgress.countdown && codingProgress.countdown > 0 ? (
                    <div style={{textAlign:'center', fontSize:'0.7rem', color:'#f59e0b', padding:'0.3rem 0', animation:'pulse 1s infinite'}}>
                      ⏳ Menunggu jeda rate limit... {codingProgress.countdown}s
                    </div>
                  ) : null}

                  {/* Dokumen sedang diproses */}
                  <div style={{fontSize:'0.72rem', color:'#93c5fd', display:'flex', gap:'0.4rem', alignItems:'flex-start'}}>
                    <span style={{flexShrink:0, opacity:0.7}}>📄</span>
                    <span style={{wordBreak:'break-all'}}>{codingProgress.docName}</span>
                  </div>

                  {/* Preview teks verbatim */}
                  <div style={{
                    fontSize:'0.72rem',
                    fontStyle:'italic',
                    color:'var(--text-secondary)',
                    backgroundColor:'rgba(0,0,0,0.2)',
                    padding:'0.5rem 0.7rem',
                    borderRadius:'6px',
                    borderLeft:'2px solid rgba(59,130,246,0.4)',
                    lineHeight:'1.5',
                    maxHeight:'70px',
                    overflowY:'auto',
                  }}>
                    &ldquo;{codingProgress.chunkPreview}&rdquo;
                  </div>

                  {/* Kode yang baru ditemukan */}
                  {codingProgress.latestCodes.length > 0 && (
                    <div>
                      <div style={{fontSize:'0.65rem', color:'var(--text-secondary)', marginBottom:'0.3rem', letterSpacing:'0.5px'}}>KODE TERKINI:</div>
                      <div style={{display:'flex', flexWrap:'wrap', gap:'0.3rem'}}>
                        {codingProgress.latestCodes.map((name, i) => (
                          <span key={i} style={{
                            fontSize:'0.68rem',
                            padding:'0.15rem 0.5rem',
                            borderRadius:'999px',
                            backgroundColor: `${COLORS[i % COLORS.length]}20`,
                            border: `1px solid ${COLORS[i % COLORS.length]}`,
                            color: COLORS[i % COLORS.length],
                          }}>{name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{padding:'0', background:'transparent', border:'none', marginBottom: 0}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem'}}>
                  <h3 style={{margin:0}}>Protokol Riset</h3>
                  {viewingProtocolId ? (
                     <span style={{fontSize:'0.65rem', backgroundColor:'#f59e0b', color:'white', padding:'0.1rem 0.4rem', borderRadius:'4px', cursor:'pointer'}} onClick={() => setViewingProtocolId(null)}>🔍 KAPSUL WAKTU ✖</span>
                  ) : (
                     <span style={{fontSize:'0.65rem', backgroundColor:'#10b981', color:'white', padding:'0.1rem 0.4rem', borderRadius:'4px'}}>● VERSI TERKINI</span>
                  )}
                </div>
                
                {viewingProtocolId ? (
                   <>
                     <textarea className="input-field" readOnly style={{width: '100%', minHeight: '150px', fontSize:'0.8rem', padding:'0.5rem', backgroundColor:'rgba(255,255,255,0.05)', color:'var(--text-secondary)'}} value={projectParameters.find(p => p.id === viewingProtocolId)?.content || 'Konteks versi hilang.'} />
                   </>
                ) : (
                   <>
                     <textarea className="input-field" style={{width: '100%', minHeight: '150px', fontSize:'0.8rem', padding:'0.5rem'}} value={draftParameter} onChange={e => setDraftParameter(e.target.value)} placeholder="(Opsional) Tulis parameter protokol riset yang harus ditaati mesin..." />
                     
                     <div style={{display:'flex', gap:'0.5rem', marginTop:'0.5rem'}}>
                       <button className="btn btn-outline btn-small" style={{flex:1, fontSize:'0.75rem', padding:'0.4rem'}} onClick={() => {
                           if (!draftParameter.trim()) return;
                           const vNum = projectParameters.length + 1;
                           const vName = `v${vNum} · ${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' })}`;
                          const newParams = projectParameters.map(p => ({...p, isActive: false}));
                          newParams.push({ id: crypto.randomUUID(), projectId: projects.length > 0 ? projects[0].id : 'proj-1', content: draftParameter, versionLabel: vName, createdAt: new Date().toISOString(), isActive: true });
                          setProjectParameters(newParams);
                       }}>💾 Simpan & Aktifkan Versi</button>
                     </div>
                     {projectParameters.length > 0 && (
                        <div style={{marginTop:'0.8rem', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                          <div style={{fontSize:'0.65rem', color:'var(--text-secondary)'}}>Aktif: {projectParameters.find(p => p.isActive)?.versionLabel || 'Tidak ada'}</div>
                          <span style={{fontSize:'0.7rem', color:'#93c5fd', cursor:'pointer', textDecoration:'underline'}} onClick={() => setShowProtocolDiffModal(true)}>Bandingkan Riwayat ⇄</span>
                        </div>
                     )}
                   </>
                )}
                
                {(() => {
                   const estToken = Math.ceil(textChunks.reduce((a,b)=>a+b.content.length, 0) / 3.5);
                   return estToken > 0 ? (
                     <div style={{marginTop: '0.5rem', fontSize:'0.7rem', color: apiProvider==='groq' && estToken > 5500 ? '#ef4444' : 'var(--text-secondary)'}}>
                       Est: {estToken.toLocaleString()} tokens
                     </div>
                   ) : null;
                })()}

                <div style={{marginTop: '1.2rem'}}>
                  <p style={{fontSize:'0.75rem', marginBottom:'0.3rem', color:'var(--text-primary)', fontWeight:'bold'}}>Mode Ekstraksi AI:</p>
                  <select className="input-field" style={{width:'100%', padding:'0.5rem', marginBottom:'0.8rem'}} value={autoCodingMode} onChange={e => setAutoCodingMode(e.target.value as any)}>
                     <option value="invivo">In Vivo Coding (Kata Kunci)</option>
                     <option value="narrative">Descriptive Coding (Narasi)</option>
                  </select>
                </div>
                {activeDocId ? (
                  <div style={{fontSize:'0.72rem', color:'#93c5fd', backgroundColor:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.2)', borderRadius:'6px', padding:'0.4rem 0.7rem', marginBottom:'0.5rem', display:'flex', alignItems:'center', gap:'0.4rem'}}>
                    <span>📄</span>
                    <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                      {documents.find(d => d.id === activeDocId)?.title || 'Dokumen dipilih'}
                    </span>
                  </div>
                ) : (
                  <div style={{fontSize:'0.72rem', color:'#f59e0b', backgroundColor:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'6px', padding:'0.4rem 0.7rem', marginBottom:'0.5rem'}}>
                    ⚠️ Pilih dokumen di panel kiri terlebih dahulu
                  </div>
                )}

                {/* Pengatur jeda untuk Rate Limit (Groq) */}
                {apiProvider === 'groq' && (
                  <div style={{marginBottom:'0.6rem', padding:'0.6rem 0.8rem', backgroundColor:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'6px'}}>
                    <div style={{fontSize:'0.7rem', color:'#f59e0b', fontWeight:'600', marginBottom:'0.4rem'}}>⏱ Jeda Antar-Segmen (Rate Limit)</div>
                    <select className="input-field" style={{width:'100%', padding:'0.4rem', fontSize:'0.75rem'}} value={chunkDelay} onChange={e => setChunkDelay(Number(e.target.value))}>
                      <option value={0}>Tanpa jeda (cepat, berisiko 429)</option>
                      <option value={11}>11 detik (aman untuk Groq Free)</option>
                      <option value={20}>20 detik (sangat aman)</option>
                      <option value={30}>30 detik (ultra aman)</option>
                    </select>
                  </div>
                )}
                <div style={{display:'flex', gap:'0.5rem'}}>
                  <button className="btn" style={{flex:1}} onClick={runAutoCoding} disabled={isAutoCoding || !activeDocId || textChunks.filter(c => c.documentId === activeDocId).length === 0}>
                    {isAutoCoding ? '⏳ Memproses...' : '▶ Eksekusi Dokumen Ini'}
                  </button>
                  {isAutoCoding && (
                    <button
                      onClick={() => { cancelAutoCodingRef.current = true; }}
                      style={{
                        flexShrink: 0,
                        padding: '0.5rem 0.8rem',
                        backgroundColor: 'rgba(239,68,68,0.15)',
                        border: '1px solid rgba(239,68,68,0.5)',
                        color: '#f87171',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        transition: 'all 0.2s',
                      }}
                      onMouseOver={e => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.3)')}
                      onMouseOut={e => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)')}
                      title="Batalkan dan simpan hasil parsial"
                    >
                      ⛔ Batalkan
                    </button>
                  )}
                </div>

                <div style={{marginTop:'1.5rem', borderTop:'1px solid rgba(255,255,255,0.07)', paddingTop:'1.2rem'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem'}}>
                    <h3 style={{margin:0, fontSize:'0.9rem'}}>Auto-Tema</h3>
                    {codes.length > 0 && <span style={{fontSize:'0.65rem', backgroundColor:'rgba(139,92,246,0.2)', color:'#c4b5fd', border:'1px solid rgba(139,92,246,0.3)', padding:'0.1rem 0.4rem', borderRadius:'4px'}}>{codes.length} kode tersedia</span>}
                  </div>
                  <p style={{fontSize:'0.72rem', color:'var(--text-secondary)', lineHeight:'1.5', margin:'0 0 0.8rem 0'}}>Klasterkan kode open coding menjadi tema-tema induk secara otomatis menggunakan AI (Axial Coding / IPA).</p>
                  <button className="btn" style={{width:'100%', backgroundColor:'rgba(139,92,246,0.15)', color:'#c4b5fd', border:'1px solid rgba(139,92,246,0.4)'}} onClick={runAutoTheme} disabled={isAutoTheme || codes.length === 0}>{isAutoTheme ? '⏳ Menganalisis Klaster...' : '✦ Buat Tema Otomatis'}</button>
                </div>
              </div>
           </div>
        )}

         {activeTab === 'chat' && (
           <div className="tab-content" style={{gap:'0.8rem'}} >
             <div style={{fontSize:'0.72rem', color:'var(--text-secondary)', lineHeight:'1.6', marginBottom:'0.5rem'}} >
               Tanyakan apa saja tentang data koding. AI menjawab berdasarkan konteks proyek ini.
             </div>
             <div className="chat-window" style={{minHeight:'200px', flex:1}} >
               {chatHistory.length === 0 ? (
                 <div style={{color:'var(--text-secondary)', fontSize:'0.8rem', fontStyle:'italic', textAlign:'center', marginTop:'2rem'}} >Belum ada percakapan.</div>
               ) : (
                 chatHistory.map((msg, i) => (
                   <div key={i} className={`chat-bubble ${msg.role === 'user' ? 'user' : 'ai'}`} style={{fontSize:'0.83rem', whiteSpace:'pre-wrap'}} >
                     {msg.content}
                   </div>
                 ))
               )}
             </div>
             <div className="chat-input-row">
               <input type="text" className="input-field" style={{flex:1, padding:'0.5rem', fontSize:'0.83rem'}} placeholder="Tanya tentang kode, tema, kutipan..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={async e => { if (e.key !== 'Enter' || !chatInput.trim()) return; const q = chatInput.trim(); setChatInput(''); setChatHistory(prev => [...prev, {role:'user', content:q}]); try { const ctx = buildQaChatPrompt(promptConfig.qaChat, {docs: documents.length, codeNames: codes.map(c=>c.name), themeNames: macroThemes.map(t=>t.name), quotes: annotations.length}); const ans = await executeLLM(ctx, q); setChatHistory(prev => [...prev, {role:'ai', content:ans}]); } catch(err:any) { setChatHistory(prev => [...prev, {role:'ai', content:`⚠️ ${err.message}`}]); } }} />
               <button className="btn btn-small" style={{flexShrink:0, padding:'0.5rem 0.8rem'}} onClick={async () => { if (!chatInput.trim()) return; const q = chatInput.trim(); setChatInput(''); setChatHistory(prev => [...prev, {role:'user', content:q}]); try { const ctx = buildQaChatPrompt(promptConfig.qaChat, {docs: documents.length, codeNames: codes.map(c=>c.name), themeNames: macroThemes.map(t=>t.name), quotes: annotations.length}); const ans = await executeLLM(ctx, q); setChatHistory(prev => [...prev, {role:'ai', content:ans}]); } catch(err:any) { setChatHistory(prev => [...prev, {role:'ai', content:`⚠️ ${err.message}`}]); } }} >➤</button>
             </div>
             {chatHistory.length > 0 && (
               <button className="btn btn-outline btn-small" style={{fontSize:'0.7rem', opacity:0.5, marginTop:'0.3rem'}} onClick={() => setChatHistory([])}>Hapus Riwayat Chat</button>
             )}
           </div>
         )}
      </div>

      {/* EXPORT MODAL EDITOR */}
      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Pratinjau Ekspor (Format: {exportType.toUpperCase()})</h3>
              <button className="btn-small btn-outline" style={{border:'none'}} onClick={() => setShowExportModal(false)}>✕ Tutup</button>
            </div>
            <div className="modal-body" style={{padding:0}}>
              <textarea style={{width:'100%', height:'60vh', border:'none', outline:'none', background:'var(--bg-color)', color:'var(--text-primary)', padding:'2rem', fontFamily:'monospace', lineHeight:'1.6', fontSize:'0.9rem'}} value={exportDraft} onChange={(e) => setExportDraft(e.target.value)} />
            </div>
            <div className="modal-footer" style={{background:'var(--panel-bg)'}}>
              <span style={{flex:1, color:'var(--text-secondary)', fontSize:'0.85rem'}}>Anda bisa mengedit kalimat struktur sebelum mengunduhnya.</span>
              <button className="btn" style={{width:'auto'}} onClick={executeDownload}>👇 Unduh File Final</button>
            </div>
          </div>
        </div>
      )}
      {/* PROTOCOL DIFF MODAL */}
      {showProtocolDiffModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth: '1000px', width:'90%'}}>
            <div className="modal-header">
              <h3>Bandingkan Riwayat Protokol</h3>
              <button className="btn-small btn-outline" style={{border:'none'}} onClick={() => setShowProtocolDiffModal(false)}>✕ Tutup</button>
            </div>
            <div className="modal-body" style={{padding:'1rem', display:'flex', gap:'1rem', height:'60vh'}}>
              
              {/* Kolom Kiri - Lampau */}
              <div style={{flex:1, display:'flex', flexDirection:'column', gap:'0.5rem'}}>
                 <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
                   <div style={{fontSize:'0.8rem', fontWeight:'bold', padding:'0.4rem', borderBottom:'2px solid #ef4444'}}>Versi Lampau:</div>
                   <select className="input-field" style={{flex:1, padding:'0.3rem'}} value={diffTargetId || ''} onChange={e => setDiffTargetId(e.target.value)}>
                     <option value="">-- Pilih Versi --</option>
                     {projectParameters.filter(p => !p.isActive).map(p => <option key={p.id} value={p.id}>{p.versionLabel} ({new Date(p.createdAt).toLocaleString()})</option>)}
                   </select>
                 </div>
                 <textarea readOnly style={{flex:1, backgroundColor:'rgba(239, 68, 68, 0.05)', color:'#fca5a5', padding:'1rem', border:'1px solid rgba(239, 68, 68, 0.2)', borderRadius:'4px', outline:'none', resize:'none', fontFamily:'monospace', fontSize:'0.85rem'}} value={projectParameters.find(p => p.id === diffTargetId)?.content || 'Silakan pilih versi pembanding di atas.'} />
              </div>

              {/* Kolom Kanan - Aktif */}
              <div style={{flex:1, display:'flex', flexDirection:'column', gap:'0.5rem'}}>
                 <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
                   <div style={{fontSize:'0.8rem', fontWeight:'bold', padding:'0.4rem', borderBottom:'2px solid #10b981', paddingTop:'0.6rem'}}>Versi Aktif Terkini: {projectParameters.find(p => p.isActive)?.versionLabel}</div>
                 </div>
                 <textarea readOnly style={{flex:1, backgroundColor:'rgba(16, 185, 129, 0.05)', color:'#86efac', padding:'1rem', border:'1px solid rgba(16, 185, 129, 0.2)', borderRadius:'4px', outline:'none', resize:'none', fontFamily:'monospace', fontSize:'0.85rem'}} value={projectParameters.find(p => p.isActive)?.content || ''} />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* EXPORT PICKER MODAL */}
      {showExportPickerModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth:'480px', width:'90%'}}>
            <div className="modal-header">
              <h3>⬇ Pilih Format Export</h3>
              <button className="btn-small btn-outline" style={{border:'none'}} onClick={() => setShowExportPickerModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{padding:'1.5rem', display:'flex', flexDirection:'column', gap:'1rem'}}>
              <div style={{fontSize:'0.8rem', color:'var(--text-secondary)', marginBottom:'0.5rem'}}>Pilih jenis data dan format ekstensi file yang diinginkan:</div>

              <div style={{padding:'1rem', border:'1px solid rgba(59,130,246,0.3)', borderRadius:'8px', backgroundColor:'rgba(59,130,246,0.05)'}}>
                <div style={{fontWeight:'600', marginBottom:'0.4rem', color:'var(--text-primary)'}}>📊 Tabel Matriks</div>
                <div style={{fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.8rem'}}>Ekspor sesuai tampilan tab MATRIKS: Dokumen, Tema, Kode, Kutipan, Initial Nothing.</div>
                <div style={{display:'flex', gap:'0.5rem'}}>
                  <button className="btn btn-outline btn-small" style={{flex:1}} onClick={() => { setShowExportPickerModal(false); generateExport('matrix', 'csv'); }}>💾 .CSV</button>
                  <button className="btn btn-outline btn-small" style={{flex:1}} onClick={() => { setShowExportPickerModal(false); generateExport('matrix', 'txt'); }}>📄 .TXT</button>
                </div>
              </div>

              <div style={{padding:'1rem', border:'1px solid rgba(139,92,246,0.3)', borderRadius:'8px', backgroundColor:'rgba(139,92,246,0.05)'}}>
                <div style={{fontWeight:'600', marginBottom:'0.4rem', color:'var(--text-primary)'}}>📝 Laporan Interpretatif</div>
                <div style={{fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.8rem'}}>Hierarki Tema → Kode → Kutipan + Initial Nothing. Cocok untuk lampiran skripsi/tesis.</div>
                <div style={{display:'flex', gap:'0.5rem'}}>
                  <button className="btn btn-outline btn-small" style={{flex:1}} onClick={() => { setShowExportPickerModal(false); generateExport('interpretive', 'md'); }}>📋 .MD</button>
                  <button className="btn btn-outline btn-small" style={{flex:1}} onClick={() => { setShowExportPickerModal(false); generateExport('interpretive', 'txt'); }}>📄 .TXT</button>
                </div>
              </div>

              <div style={{padding:'1rem', border:'1px solid rgba(16,185,129,0.3)', borderRadius:'8px', backgroundColor:'rgba(16,185,129,0.05)'}}>
                <div style={{fontWeight:'600', marginBottom:'0.4rem', color:'var(--text-primary)'}}>🔗 REFI-QDA Codebook</div>
                <div style={{fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.8rem'}}>Standar XML Internasional. Impor langsung Kerangka Tema & Kode ke NVivo, ATLAS.ti, atau MAXQDA.</div>
                <div style={{display:'flex', gap:'0.5rem'}}>
                  <button className="btn btn-outline btn-small" style={{flex:1, borderColor:'#10b981', color:'#34d399'}} onClick={() => { setShowExportPickerModal(false); generateExport('refi-qdc', 'qdc'); }}>⚙️ Ekspor .QDC</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* PROMPT EDITOR MODAL */}
      {showPromptModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth: '800px'}}>
            <div className="modal-header">
              <h3>⚙️ Pengaturan Prompt AI</h3>
              <button className="btn-small btn-outline" style={{border:'none'}} onClick={() => setShowPromptModal(false)}>✕</button>
            </div>
            
            <div className="modal-body" style={{display:'flex', gap:'1rem', padding:'1.5rem', height:'65vh'}}>
               <div style={{flex:'0 0 220px', borderRight:'1px solid var(--border-color)', paddingRight:'1rem', display:'flex', flexDirection:'column', gap:'0.5rem'}}>
                  {PROMPT_META.map(meta => (
                     <div key={meta.key} className={`dropdown-item ${editingPromptKey === meta.key ? 'active' : ''}`} style={{textAlign:'left', padding:'0.8rem', borderRadius:'6px', display:'flex', flexDirection:'column', gap:'0.3rem'}} onClick={() => {
                        setEditingPromptKey(meta.key);
                        setPromptDraft(promptConfig[meta.key] as string);
                     }}>
                        <div style={{fontWeight:'bold', color:'var(--text-primary)'}}>{meta.icon} {meta.label}</div>
                     </div>
                  ))}
               </div>
               
               <div style={{flex:1, display:'flex', flexDirection:'column', gap:'0.8rem', border:'1px solid var(--border-color)', borderRadius:'8px', padding:'1rem', backgroundColor:'rgba(0,0,0,0.2)'}}>
                  <div style={{fontSize:'0.8rem', color:'var(--text-secondary)', lineHeight:'1.5'}}>
                     {PROMPT_META.find(m => m.key === editingPromptKey)?.description}
                  </div>
                  <textarea 
                     style={{flex:1, width:'100%', resize:'none', backgroundColor:'transparent', color:'var(--text-primary)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:'4px', padding:'1rem', fontFamily:'monospace', fontSize:'0.85rem', lineHeight:'1.5', outline:'none'}} 
                     value={promptDraft} 
                     onChange={(e) => setPromptDraft(e.target.value)} 
                  />
                  <div style={{display:'flex', justifyContent:'space-between'}}>
                     <button className="btn-outline btn-small" style={{color:'#fca5a5', borderColor:'transparent'}} onClick={() => {
                        if(confirm('Kembalikan ke prompt default asli?')) {
                           setPromptDraft(DEFAULT_PROMPTS[editingPromptKey]);
                        }
                     }}>↺ Reset ke Default</button>
                     
                     <button className="btn-small" style={{backgroundColor:'#3b82f6', color:'white'}} onClick={() => {
                        setPromptConfig(prev => ({...prev, [editingPromptKey]: promptDraft}));
                        alert('Prompt berhasil disimpan! Perubahan sudah aktif untuk eksekusi selanjutnya.');
                     }}>💾 Simpan Prompt Ini</button>
                  </div>
               </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
