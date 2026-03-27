# UTakip Tasarım ve Geliştirme Kuralları

Bu döküman, UTakip uygulamasının görsel bütünlüğünü ve kullanıcı deneyimini korumak için uyulması gereken "altın kuralları" içerir.

## 1. Görünmez Kaydırma Çubukları (Scrollbars)
Uygulama genelinde hiçbir elementte görünür bir kaydırma çubuğu **bulunmamalıdır**. Kaydırma özelliği çalışmalı ancak görsel çubuk gizlenmelidir.
- **Kural:** Her kaydırılabilir alan için şu 3 CSS kuralı uygulanmalıdır:
    - `scrollbar-width: none;` (Firefox)
    - `-ms-overflow-style: none;` (IE/Edge)
    - `&::-webkit-scrollbar { display: none; }` (Chrome/Safari)

## 2. Sohbet (Coach-Chat) Mesaj Formatı
Sanal Koç ile yapılan görüşmelerin okunabilirliğini artırmak için:
- **Kural:** Mesaj kutuları her zaman tam genişlikte (`width: 100%`) olmalıdır.
- **Kural:** JS tarafında metne asla manuel "satır kırma" (word wrapping) uygulanmamalıdır. Tarayıcının doğal sarmalaması (`word-break/wrap`) kullanılmalıdır.

## 3. Terminoloji ve Bilgi Sunumu: "Hedef"
Gelişim cetvelindeki basamaklar için "Aşama" kelimesi yerine **"Hedef"** kelimesi kullanılmalıdır.
- **Hizalama:** Cetvel altındaki tüm metinler (tahminler) **sola hizalı** (`text-align: left; padding-left: 5px;`) olmalıdır.
- **Sadeleştirme:** Cetvel altında "X.X mm / 10.0 mm" gibi metin tabanlı ilerleme bilgisi **gösterilmemelidir**. İlerleme görsel olarak cetvel çubuğundan takip edilmelidir.
- **Tarih Tahminleri:** Her hedef basamağı için %50 (orta nokta) ve %100 (tamamlama) tarihleri, aylık büyüme hızına göre hesaplanarak gösterilmelidir.

## 4. Günlük Çalışma Hedefi (Daily Goal)
Gelişim cetvelinin altında, günlük çalışma disiplinini takip eden ikincil bir bar bulunmalıdır.
- **Varsayılan:** 6 saat (360 dakika). Ayarlar panelinden değiştirilebilir.
- **Markerlar:** 4 saat (Uzman Alt Sınırı) görsel olarak işaretlenmelidir.
- **Renk Kademeleri (Dinamik):**
    - `0 - 2 Saat`: **Beyaz** (#ffffff)
    - `2 - 4 Saat`: **Turuncu** (#f39c12)
    - `4 Saat - %75 Hedef`: **Yeşil** (#2ecc71)
    - `%75 Hedef - %100+`: **Mor** (#bb86fc)
- **Kullanılabilirlik:** Hedef değiştikçe bar etiketleri ve yüzdelik dilimler otomatik güncellenmelidir.

## 5. Veri Güvenliği ve Yedekleme (Data Safety)
Kullanıcının aylar süren gelişim verilerini korumak için:
- **Yedekleme:** Tüm uygulama verileri `.json` formatında dışa aktarılabilir (Export) olmalıdır.
- **Yükleme:** Daha önce alınan yedekler sisteme geri yüklenebilir (Import) olmalıdır.
- **Güvenlik Bölgesi:** Bu işlemler Ayarlar panelinde özel bir "Veri Yönetimi" kartı içerisinde sunulmalıdır.

## 6. Başarı Bildirimleri (Achievements)
Kullanıcının motivasyonunu artırmak için:
- **Tetikleyiciler:** Günlük çalışma hedefi veya 1 cm (10 mm) basamak hedefleri aşıldığında görsel bildirim verilmelidir.
- **Stil:** Bildirimler ekranın üstünde, parlayan gradyan renklerle (Mor-Yeşil) ve başarı simgeleriyle (🏆, 🔥) görünmelidir.
- **Sıklık:** Her başarı oturum başına sadece bir kez tetiklenmelidir.

## 7. Mobil Kurulum ve PWA (Mobile App)
Uygulamanın mobil cihazlarda "Uygulama" gibi davranması için:
- **Kurulabilirlik:** `manifest.json` ve `sw.js` dosyaları üzerinden "Ana Ekrana Ekle" desteği sunulmalıdır.
- **İkonografi:** Yüksek çözünürlüklü (`512x512`) ve modern bir `icon.png` kullanılmalıdır.
- **Offline Destek:** Kritik dosyalar cache'lenerek internet bağlantısı olmadan da uygulamanın açılması sağlanmalıdır.

---
*Bu kurallar kullanıcı talebi üzerine 21 Mart 2026 tarihinde sabitlenmiştir.*
