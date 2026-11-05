# Điện Biên Phủ 1954

Game bắn súng góc nhìn thứ nhất chạy trên trình duyệt (bản thử nghiệm, dành cho máy tính).
Bối cảnh tháng 5/1954: đánh chiếm cứ điểm cuối cùng, diệt hết quân địch rồi kéo cờ trên nóc hầm chỉ huy.

## Chơi
- Bản web: `https://<tên-tài-khoản>.github.io/<tên-repo>/`
- Chơi trên máy: chạy `python -m http.server` trong thư mục này, rồi mở `http://localhost:8000`.
  (Mở thẳng file index.html cũng được trên Chrome, nhưng chạy qua server là ổn định nhất.)
- Máy yếu: thêm `?low` vào cuối địa chỉ (tắt hậu kỳ, giảm độ phân giải).

## Cấu trúc
| Đường dẫn | Nội dung |
|---|---|
| `index.html` | Trang chính, nạp Three.js và các module theo thứ tự |
| `css/style.css` | Giao diện kiểu PS2 |
| `src/config.js` | Thông số: độ khó, tốc độ, sát thương |
| `src/textures.js` | Texture vẽ bằng code (đất đỏ, bao cát, gỗ, tôn…) |
| `src/map.js` | Bản đồ cứ điểm, giao thông hào, hầm, cờ |
| `src/audio.js` | Âm thanh tổng hợp (súng, va chạm, gió) |
| `src/weapon.js` | Tiểu liên Type 50, giật, hiệu ứng |
| `src/enemies.js` | Lính địch: mô hình, hoạt ảnh, AI |
| `src/realism.js` | Vật liệu PBR, ánh sáng môi trường, hậu kỳ màu phim chiến tranh |
| `src/main.js` | Vòng lặp, người chơi, giao diện, luồng game |
| `vendor/` | Three.js r160 (đặt sẵn, không cần mạng) |
| `test/` | Trang thử riêng súng và lính địch |

Mỗi file trong `src/` là script thường, gắn vào biến toàn cục `G`. Thêm module mới: đặt vào `src/`
và thêm tên vào danh sách `MODULES` trong `index.html`. Sau mỗi lần sửa, tăng `?v=` trong `index.html`
để trình duyệt không dùng bản cũ.

## Nhánh
- `main`: bản ổn định, GitHub Pages phát hành từ nhánh này.
- `dev`: nơi làm việc; khi chạy ổn thì merge vào `main`.

Three.js: giấy phép MIT (`vendor/THREE_LICENSE`).
