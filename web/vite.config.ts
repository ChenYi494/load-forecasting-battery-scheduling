import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // ECharts and React in their own files: they change rarely, so browsers keep them cached
        codeSplitting: {
          groups: [
            { name: 'echarts', test: /node_modules[\\/](echarts|zrender)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)/ },
          ],
        },
      },
    },
    // The tree-shaken ECharts bundle is about 0.6 MB before gzip; that is expected for a chart library
    chunkSizeWarningLimit: 700,
  },
})
