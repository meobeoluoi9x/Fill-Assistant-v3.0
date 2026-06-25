// Dữ liệu khởi tạo tạm thời.
// Bạn có thể chỉnh slot, sản phẩm, sức chứa và tồn cabin ban đầu tại đây.

window.FILL_CONFIG = {
  products: {
    "Aquafina": { pack: 28, minPacks: 2 },
    "Pepsi": { pack: 24, minPacks: 1 },
    "Pepsi chanh": { pack: 24, minPacks: 1 },
    "Revive": { pack: 24, minPacks: 1 },
    "Boss": { pack: 24, minPacks: 1 },
    "Good Mood": { pack: 24, minPacks: 1 },
    "Rockstar": { pack: 24, minPacks: 1 },
    "Sting": { pack: 24, minPacks: 1 }
  },
  machines: [
    { name: "D3", group: "A", cycleDays: 1 },
    { name: "D8", group: "A", cycleDays: 1 },
    { name: "D9", group: "A", cycleDays: 1 },
    { name: "Thư Viện", group: "A", cycleDays: 1 },
    { name: "Trong Ga", group: "B", cycleDays: 7 },
    { name: "Ngoài Ga", group: "B", cycleDays: 7 },
    { name: "Ga Giáp Bát", group: "B", cycleDays: 7 }
  ],
  slots: [
    // Dữ liệu mẫu. Khi dùng thật, thay bằng slot thực tế của từng máy.
    { machine: "D3", slot: 1, product: "Aquafina", max: 24 },
    { machine: "D3", slot: 2, product: "Pepsi", max: 24 },
    { machine: "D3", slot: 3, product: "Revive", max: 24 },

    { machine: "D8", slot: 1, product: "Aquafina", max: 24 },
    { machine: "D8", slot: 2, product: "Pepsi chanh", max: 24 },
    { machine: "D8", slot: 3, product: "Boss", max: 24 },

    { machine: "D9", slot: 1, product: "Aquafina", max: 24 },
    { machine: "D9", slot: 2, product: "Rockstar", max: 24 },
    { machine: "D9", slot: 3, product: "Revive", max: 24 },

    { machine: "Thư Viện", slot: 1, product: "Aquafina", max: 24 },
    { machine: "Thư Viện", slot: 2, product: "Good Mood", max: 24 },
    { machine: "Thư Viện", slot: 3, product: "Pepsi", max: 24 },

    { machine: "Trong Ga", slot: 1, product: "Aquafina", max: 24 },
    { machine: "Trong Ga", slot: 2, product: "Pepsi", max: 24 },

    { machine: "Ngoài Ga", slot: 1, product: "Aquafina", max: 24 },
    { machine: "Ngoài Ga", slot: 2, product: "Revive", max: 24 },

    { machine: "Ga Giáp Bát", slot: 1, product: "Aquafina", max: 24 },
    { machine: "Ga Giáp Bát", slot: 2, product: "Pepsi", max: 24 }
  ],
  initialCabin: [
    // Tồn cabin ban đầu theo Máy + Sản phẩm.
    { machine: "D3", product: "Aquafina", qty: 56 },
    { machine: "D3", product: "Pepsi", qty: 24 },
    { machine: "D3", product: "Revive", qty: 24 },
    { machine: "D8", product: "Aquafina", qty: 56 },
    { machine: "D8", product: "Pepsi chanh", qty: 24 },
    { machine: "D8", product: "Boss", qty: 24 },
    { machine: "D9", product: "Aquafina", qty: 56 },
    { machine: "D9", product: "Rockstar", qty: 24 },
    { machine: "D9", product: "Revive", qty: 24 },
    { machine: "Thư Viện", product: "Aquafina", qty: 56 },
    { machine: "Thư Viện", product: "Good Mood", qty: 24 },
    { machine: "Thư Viện", product: "Pepsi", qty: 24 }
  ]
};
