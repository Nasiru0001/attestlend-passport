/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TEST_TOKEN_ADDRESS?: string;
  readonly VITE_LOAN_BOOK_ADDRESS?: string;
  readonly VITE_CREDIT_PASSPORT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
