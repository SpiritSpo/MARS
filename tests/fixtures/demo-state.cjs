// Legacy sample records belong to tests only; never import this fixture into dist.
// Captured from d7925ff before removing automatic demonstration data.
module.exports = {
  "machines": [
    {
      "id": "M001",
      "name": "Bobcat S650",
      "type": "Мини-погрузчик",
      "object": "o1",
      "income": 425000,
      "expense": 184000,
      "status": "free",
      "operator": "Алексей Морозов",
      "hours": 148,
      "plan": 176,
      "meter": 1248,
      "cost": 5600000,
      "rate": 2900,
      "year": 2021,
      "service": "2026-11-12"
    },
    {
      "id": "M002",
      "name": "JCB 3CX",
      "type": "Экскаватор-погрузчик",
      "object": "o2",
      "income": 510000,
      "expense": 227000,
      "status": "free",
      "operator": "Михаил Иванов",
      "hours": 156,
      "plan": 176,
      "meter": 3820,
      "cost": 8400000,
      "rate": 3300,
      "year": 2020,
      "service": "2026-11-16"
    },
    {
      "id": "M003",
      "name": "Liebherr 132 EC-H",
      "type": "Башенный кран",
      "object": "o1",
      "income": 1250000,
      "expense": 682000,
      "status": "free",
      "operator": "Армен Петросян",
      "hours": 172,
      "plan": 192,
      "meter": 6310,
      "cost": 22000000,
      "rate": 7300,
      "year": 2018,
      "service": "2026-11-20"
    },
    {
      "id": "M004",
      "name": "Potain MDT 219",
      "type": "Башенный кран",
      "object": "o3",
      "income": 1130000,
      "expense": 590000,
      "status": "free",
      "operator": "Владимир Смирнов",
      "hours": 164,
      "plan": 192,
      "meter": 4270,
      "cost": 19500000,
      "rate": 6900,
      "year": 2019,
      "service": "2026-11-22"
    },
    {
      "id": "M005",
      "name": "КС-55713",
      "type": "Автокран",
      "object": "o2",
      "income": 790000,
      "expense": 418000,
      "status": "free",
      "operator": "Роман Козлов",
      "hours": 136,
      "plan": 176,
      "meter": 5180,
      "cost": 12000000,
      "rate": 5800,
      "year": 2020,
      "service": "2026-11-09"
    },
    {
      "id": "M006",
      "name": "КС-65719",
      "type": "Автокран",
      "object": "o2",
      "income": 940000,
      "expense": 512000,
      "status": "free",
      "operator": "Павел Павлов",
      "hours": 144,
      "plan": 176,
      "meter": 3900,
      "cost": 16500000,
      "rate": 6500,
      "year": 2021,
      "service": "2026-11-14"
    },
    {
      "id": "M007",
      "name": "Lonking CDM312",
      "type": "Мини-погрузчик",
      "object": "o3",
      "income": 360000,
      "expense": 176000,
      "status": "free",
      "operator": "Иван Петров",
      "hours": 140,
      "plan": 176,
      "meter": 950,
      "cost": 3900000,
      "rate": 2600,
      "year": 2023,
      "service": "2026-11-19"
    },
    {
      "id": "M008",
      "name": "JCB 531-70",
      "type": "Телескопический погрузчик",
      "object": "o2",
      "income": 460000,
      "expense": 232000,
      "status": "repair",
      "operator": "Александр Егоров",
      "hours": 104,
      "plan": 176,
      "meter": 2870,
      "cost": 9600000,
      "rate": 4400,
      "year": 2020,
      "service": "2026-11-02"
    },
    {
      "id": "M009",
      "name": "КАМАЗ 65115",
      "type": "Самосвал",
      "object": "o1",
      "income": 550000,
      "expense": 318000,
      "status": "free",
      "operator": "Сергей Фёдоров",
      "hours": 152,
      "plan": 176,
      "meter": 7140,
      "cost": 7100000,
      "rate": 3600,
      "year": 2019,
      "service": "2026-11-18"
    },
    {
      "id": "M010",
      "name": "Hyundai Porter",
      "type": "Грузовой автомобиль",
      "object": "o2",
      "income": 245000,
      "expense": 133000,
      "status": "free",
      "operator": "Виктор Николаев",
      "hours": 128,
      "plan": 176,
      "meter": 2080,
      "cost": 2800000,
      "rate": 1900,
      "year": 2021,
      "service": "2026-11-25"
    }
  ],
  "objects": [
    {
      "id": "o1",
      "name": "Коммунарка",
      "address": "Москва · Новомосковский округ",
      "manager": "Андрей Соколов"
    },
    {
      "id": "o2",
      "name": "ЖК Хорошёвский",
      "address": "Москва · Хорошёво-Мнёвники",
      "manager": "Дмитрий Орлов"
    },
    {
      "id": "o3",
      "name": "ЖК Сити Парк",
      "address": "Москва · Пресненский район",
      "manager": "Сергей Волков"
    }
  ],
  "state": {
    "version": 1,
    "operations": [],
    "shifts": [
      {
        "id": "shift-101",
        "machine": "M001",
        "date": "2026-11-01",
        "hours": 8,
        "meter": 1248,
        "condition": "ok",
        "note": "Замечаний нет",
        "status": "pending"
      },
      {
        "id": "shift-102",
        "machine": "M002",
        "date": "2026-11-01",
        "hours": 8,
        "meter": 3820,
        "condition": "ok",
        "note": "Замечаний нет",
        "status": "pending"
      },
      {
        "id": "shift-103",
        "machine": "M007",
        "date": "2026-11-01",
        "hours": 7,
        "meter": 950,
        "condition": "ok",
        "note": "Завершена работа на объекте",
        "status": "approved",
        "waybill": "ПЛ-0001"
      }
    ],
    "maintenance": [
      {
        "id": "service-101",
        "machine": "M008",
        "date": "2026-11-02",
        "type": "Ремонт гидравлики",
        "note": "Диагностика и замена уплотнений",
        "status": "progress",
        "number": "ЗР-0001",
        "kind": "repair",
        "priority": "high",
        "assignee": "Демо · Механик № 1",
        "dueDate": "2026-11-02",
        "createdAt": "2026-11-02T09:00:00+03:00",
        "reportedBy": "Демо · Менеджер",
        "blocking": true,
        "readyConfirmed": false,
        "photos": [
          {
            "id": "demo-hydraulics",
            "url": "./assets/demo-hydraulics.svg",
            "name": "Условная схема неисправности"
          }
        ],
        "history": [
          {
            "at": "2026-11-02T09:00:00+03:00",
            "text": "Заявка создана · условный пример",
            "by": "Демо · Менеджер"
          },
          {
            "at": "2026-11-02T09:00:00+03:00",
            "text": "Механик принял заявку в работу",
            "by": "Демо · Механик № 1"
          }
        ],
        "parts": []
      },
      {
        "id": "service-102",
        "machine": "M005",
        "date": "2026-11-09",
        "type": "Плановое ТО",
        "note": "Масло, фильтры, проверка тормозной системы",
        "status": "planned",
        "number": "ЗР-0002",
        "kind": "service",
        "priority": "normal",
        "assignee": "Демо · Механик № 2",
        "dueDate": "2026-11-09",
        "createdAt": "2026-11-09T09:00:00+03:00",
        "reportedBy": "Демо · Менеджер",
        "blocking": false,
        "readyConfirmed": false,
        "photos": [],
        "history": [
          {
            "at": "2026-11-09T09:00:00+03:00",
            "text": "Заявка создана · условный пример",
            "by": "Демо · Менеджер"
          }
        ],
        "parts": []
      },
      {
        "id": "service-103",
        "machine": "M001",
        "date": "2026-11-12",
        "type": "Плановое ТО",
        "note": "Замена масла и фильтров",
        "status": "planned",
        "number": "ЗР-0003",
        "kind": "service",
        "priority": "normal",
        "assignee": "Демо · Механик № 2",
        "dueDate": "2026-11-12",
        "createdAt": "2026-11-12T09:00:00+03:00",
        "reportedBy": "Демо · Менеджер",
        "blocking": false,
        "readyConfirmed": false,
        "photos": [],
        "history": [
          {
            "at": "2026-11-12T09:00:00+03:00",
            "text": "Заявка создана · условный пример",
            "by": "Демо · Менеджер"
          }
        ],
        "parts": []
      },
      {
        "id": "service-demo-closed",
        "number": "ЗР-0004",
        "machine": "M002",
        "kind": "repair",
        "type": "Замена топливного фильтра",
        "note": "Условный пример завершённого ремонта. Нестабильная работа двигателя.",
        "date": "2026-10-28",
        "dueDate": "2026-10-29",
        "createdAt": "2026-10-28T09:00:00+03:00",
        "completedAt": "2026-10-29T14:00:00+03:00",
        "status": "done",
        "priority": "normal",
        "assignee": "Демо · Механик № 1",
        "reportedBy": "Демо · Машинист",
        "blocking": false,
        "photos": [],
        "parts": [],
        "laborCost": 8500,
        "externalCost": 2000,
        "resultNote": "Фильтр заменён, система проверена. Техника возвращена в работу.",
        "costIncludedInDemo": true,
        "history": [
          {
            "at": "2026-10-28T09:00:00+03:00",
            "text": "Сообщение о неисправности принято",
            "by": "Демо · Машинист"
          },
          {
            "at": "2026-10-28T11:00:00+03:00",
            "text": "Начата диагностика",
            "by": "Демо · Механик № 1"
          },
          {
            "at": "2026-10-29T14:00:00+03:00",
            "text": "Ремонт завершён, техника возвращена в работу",
            "by": "Демо · Механик № 1"
          }
        ]
      }
    ],
    "stock": [
      {
        "id": "part-1",
        "name": "Фильтр масляный JCB",
        "sku": "02/100284",
        "unit": "шт.",
        "qty": 4,
        "min": 2
      },
      {
        "id": "part-2",
        "name": "Масло моторное 10W-40",
        "sku": "OIL-10W40",
        "unit": "л",
        "qty": 120,
        "min": 40
      },
      {
        "id": "part-3",
        "name": "Фильтр воздушный Bobcat",
        "sku": "6673752",
        "unit": "шт.",
        "qty": 1,
        "min": 2
      },
      {
        "id": "part-4",
        "name": "Смазка универсальная",
        "sku": "GREASE-400",
        "unit": "шт.",
        "qty": 18,
        "min": 5
      },
      {
        "id": "part-5",
        "name": "Фильтр топливный",
        "sku": "FUEL-01",
        "unit": "шт.",
        "qty": 6,
        "min": 3
      },
      {
        "id": "part-6",
        "name": "Рукав высокого давления",
        "sku": "RVD-12",
        "unit": "шт.",
        "qty": 2,
        "min": 2
      }
    ],
    "stockMoves": [],
    "machinePhotos": {},
    "workshopVersion": 1
  }
};
