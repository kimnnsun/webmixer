import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // public 폴더 설정 (기본값 'public' — 명시적으로 지정)
  publicDir: 'public',

  // 빌드/배포 시 base 경로 (루트에서 서빙)
  base: '/',

  build: {
    // 빌드 출력 디렉토리
    outDir: 'dist',
    // scene.splinecode 등 큰 에셋의 경고 임계값 상향
    chunkSizeWarningLimit: 2000,
  },

  server: {
    // 로컬 개발 시 .splinecode MIME 타입 지원
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
})
