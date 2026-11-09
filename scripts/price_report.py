"""Short machine-generated report for the Actions summary."""
import json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
s=json.loads((root/'.price-sync/summary.json').read_text())
labels={'found':'Найдено товаров','checked':'Проверено','matching':'Цены совпадают','updated':'Цены обновлены','without_public_price':'Нет публичной цены на официальном сайте','explicit_request':'Из них «Цену уточняйте»','hidden_unavailable':'Из них числовая цена скрыта','unverified':'Не удалось проверить','errors':'Ошибок'}
print('Сверка официальных цен\n')
for key,label in labels.items():print(f'- {label}: {s[key]}')
print(f'\nЗавершено (UTC): {s["completed_at"]}. Данные применены: {s["applied"]}.')
