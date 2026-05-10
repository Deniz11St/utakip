@echo off
cd /d "C:\Users\dnizd\.gemini\antigravity\scratch\UTakip"
git add -A
git commit -m "v3.0.0: Firebase senkronizasyonu kaldirildi, uygulama tamamen yerel mobil (local-only) sisteme gecirildi"
git push origin main
echo.
echo PUSH TAMAMLANDI! Simdi mobil cihazinda uygulamayi yenile ve yeni (v3.0.0) surumunu kullanmaya basla.
pause
