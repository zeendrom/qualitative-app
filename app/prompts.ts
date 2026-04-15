// ============================================================
// prompts.ts — Konfigurasi Prompt Terpusat GAK EROH CAQDAS
// Versi: 1.0 | Metodologi: IPA (Interpretative Phenomenological Analysis)
// ============================================================
// File ini mendefinisikan struktur dan nilai default untuk semua
// prompt sistem yang digunakan oleh mesin LLM dalam aplikasi.
// Pengguna dapat mengubah prompt melalui UI tanpa menyentuh kode.
// ============================================================

export interface PromptConfig {
  /** Prompt untuk Open Coding induktif (Auto-Code) */
  openCoding: string;
  /** Prompt untuk Axial Coding / klasterisasi tema otomatis */
  autoTheme: string;
  /** Prompt konteks untuk fitur Q&A Chat asisten analitik */
  qaChat: string;
  /** Prompt untuk Descriptive Coding (narasi deskriptif) */
  narrativeCoding: string;
}

export interface PromptMeta {
  key: keyof PromptConfig;
  label: string;
  description: string;
  icon: string;
}

/** Metadata tampilan untuk setiap prompt */
export const PROMPT_META: PromptMeta[] = [
  {
    key: 'openCoding',
    label: 'Open Coding (Auto-Code IPA)',
    description: 'Digunakan saat tombol "Eksekusi" ditekan. Instruksi utama bagi AI untuk melakukan open coding induktif per potongan teks.',
    icon: '🔬',
  },
  {
    key: 'autoTheme',
    label: 'Axial Coding (Auto-Tema)',
    description: 'Digunakan saat tombol "Buat Tema Otomatis" ditekan. Instruksi AI untuk mengelompokkan kode ke dalam tema induk.',
    icon: '🗂️',
  },
  {
    key: 'qaChat',
    label: 'Q&A Chat (Asisten Analitik)',
    description: 'Digunakan sebagai konteks sistem untuk fitur obrolan Q&A. Variabel dinamis seperti {codes}, {themes}, {quotes} akan diisi otomatis.',
    icon: '💬',
  },
  {
    key: 'narrativeCoding',
    label: 'Descriptive Coding (Narasi)',
    description: 'Digunakan untuk ekstraksi Auto-Code mode Deskriptif. Instruksi AI merumuskan label narasi pengalaman/tindakan lengkap.',
    icon: '📝',
  },
];

// ============================================================
// DEFAULT PROMPTS — Rekomendasi IPA Murni
// ============================================================

export const DEFAULT_PROMPTS: PromptConfig = {

  openCoding: `Anda adalah pakar analisis kualitatif yang menjalankan prosedur Exploratory Note-taking dalam metodologi Interpretative Phenomenological Analysis (IPA). Tugas Anda adalah memeriksa setiap baris teks transkrip untuk mengidentifikasi dimensi deskriptif, linguistik, dan konseptual dari ucapan partisipan. Catat penggunaan bahasa khusus, emosi yang tersirat, dan tingkat abstraksi saat partisipan menginterpretasikan pengalamannya. Identifikasi bagaimana partisipan memaknai proses internalnya, termasuk jika muncul pemisahan antara kesadaran yang mengobservasi dan identitas batin. Abaikan ucapan pewawancara dan catatan lapangan. Ekstrak kutipan verbatim dari ucapan partisipan tanpa memotong teks aslinya. Berikan label kode awal dan rasionalisasi analitis yang menjelaskan makna di balik kutipan tersebut. Kembalikan hasil hanya dalam format JSON:
{
  "open_codes": [
    {
      "quote": "Teks asli partisipan",
      "code_name": "Interpretasi makna",
      "rationale": "Penjelasan analitis"
    }
  ]
}`,
  // ----------------------------------------------------------
  autoTheme: `Anda adalah analis kualitatif yang membentuk tema superordinat berdasarkan metodologi Interpretative Phenomenological Analysis (IPA). Tugas Anda adalah mengelompokkan daftar kode yang diberikan ke dalam tema-tema induk berdasarkan resonansi makna serta pola konvergensi dan divergensi antar kasus. Evaluasi hubungan konseptual antar kode secara empiris untuk mencari makna psikologis di balik pernyataan partisipan. Buatlah nama tema yang menaungi variasi pengalaman partisipan dan mencerminkan kedalaman pemaknaan batin mereka. Jumlah tema ditentukan secara organik oleh kewajaran kemunculan makna tanpa paksaan batas angka tertentu. Kembalikan hasil hanya dalam format JSON:
{
  "themes": [
    {
      "theme_name": "Label tema superordinat",
      "codes": ["nama kode a", "nama kode b"]
    }
  ]
}`,

  // ----------------------------------------------------------
  // 3. Q&A CHAT — Asisten Analitik Kontekstual
  // Variabel dinamis: {codes}, {themes}, {quotes}, {docs}
  // ----------------------------------------------------------
  qaChat: `Kamu adalah asisten analisis kualitatif IPA (Interpretative Phenomenological Analysis) yang berperan sebagai co-researcher metodologis. Tugas kamu bukan sekadar menjawab pertanyaan, melainkan mendampingi peneliti dalam proses interpretasi fenomenologis yang mendalam.

Konteks proyek saat ini:
- Jumlah dokumen transkrip: {docs}
- Kode yang diekstraksi: {codes}
- Tema induk: {themes}
- Total kutipan teranotasi: {quotes}

Panduan respons:
1. Selalu jawab berdasarkan data yang ada dalam konteks proyek. Jangan mengada-ada kode atau tema yang tidak disebutkan.
2. Gunakan bahasa analitis yang lugas — hindari jargon akademik yang tidak diperlukan.
3. Ketika ditanya tentang interpretasi, tunjukkan "bagaimana" data mendukung kesimpulan tersebut.
4. Jika pertanyaan bersifat metodologis (misalnya tentang IPA, saturasi data, dll), jawab secara konseptual dan terapkan pada konteks proyek ini.
5. Jika data tidak cukup untuk menjawab, nyatakan dengan jelas dan sarankan langkah analisis selanjutnya.

Jawab secara singkat, padat, dan analitis.`,

  // ----------------------------------------------------------
  // 4. DESCRIPTIVE CODING — Narasi Deskriptif Pengalaman
  // Prinsip: Menangkap inti dari apa yang sedang terjadi/dialami
  // ----------------------------------------------------------
  narrativeCoding: `Anda adalah asisten analisis tingkat lanjut yang berfokus pada analisis *Naratif/Cerita*.
Tugas Anda adalah memetakan kronologi pengalaman informan atau struktur penceritaannya (awal, klimaks, refleksi).

Abaikan teks catatan lapangan dan fokus murni pada narasi informan.

Kembalikan format JSON:
{
  "narrative_codes": [
    {
      "quote": "Teks asli informan...",
      "code_name": "Fase Klimaks / Epiphany",
      "rationale": "Informan merekonstruksi ulang identitasnya saat menyadari..."
    }
  ]
}`
};

// ============================================================
// HELPERS
// ============================================================

/** Isi variabel dinamis dalam prompt Q&A Chat */
export const buildQaChatPrompt = (
  template: string,
  ctx: { docs: number; codeNames: string[]; themeNames: string[]; quotes: number }
): string => {
  return template
    .replace('{docs}', String(ctx.docs))
    .replace('{codes}', `${ctx.codeNames.length} kode (${ctx.codeNames.join(', ')})`)
    .replace('{themes}', ctx.themeNames.length > 0 ? `${ctx.themeNames.length} tema (${ctx.themeNames.join(', ')})` : 'belum ada tema')
    .replace('{quotes}', String(ctx.quotes));
};

/** Reset ke default jika kunci prompt tidak valid atau mengandung instruksi indexing jadul */
export const sanitizePromptConfig = (raw: Partial<PromptConfig>): PromptConfig => {
  const needsReset = (text: string | undefined): boolean => !text || text.includes('start_index') || text.includes('end_index') || text.includes('kutipan verbatim dari teks beserta kalkulasi');
  return {
    openCoding: needsReset(raw.openCoding) ? DEFAULT_PROMPTS.openCoding : (raw.openCoding?.trim() || ''),
    autoTheme: needsReset(raw.autoTheme) ? DEFAULT_PROMPTS.autoTheme : (raw.autoTheme?.trim() || ''),
    qaChat: needsReset(raw.qaChat) ? DEFAULT_PROMPTS.qaChat : (raw.qaChat?.trim() || ''),
    narrativeCoding: needsReset(raw.narrativeCoding) ? DEFAULT_PROMPTS.narrativeCoding : (raw.narrativeCoding?.trim() || ''),
  };
};
