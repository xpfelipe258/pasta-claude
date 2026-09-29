import openpyxl
from copy import copy
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

SRC = "/home/user/pasta-claude/PLANO_DE_PRODUCAO_198_POR_EMPRESA_V3.xlsm"
DST = "/home/user/pasta-claude/PLANO_DE_PRODUCAO_198_POR_EMPRESA_V3.xlsm"

wb = openpyxl.load_workbook(SRC, keep_vba=True)
ws = wb['PAINEL KPI']

NEW_MAX = 3214

# ─────────────────────────────────────────────────────────
# 1. Fórmulas dinâmicas para B4 (início) e B5 (fim)
#    B4 = segunda-feira da semana de B3
#    B5 = sexta-feira da semana de B3
# ─────────────────────────────────────────────────────────
ws['B4'] = '=B3-WEEKDAY(B3,2)+1'
ws['B5'] = '=B3-WEEKDAY(B3,2)+5'
ws['B6'] = 'Altere B3 para a data de referência. B4/B5 calculam a semana automaticamente.'

print("1/3 Datas dinâmicas: B4=Seg, B5=Sex calculados de B3")

# ─────────────────────────────────────────────────────────
# 2. Styles
# ─────────────────────────────────────────────────────────
HEADER_FONT = Font(name='Calibri', bold=True, size=11, color='FFFFFF')
HEADER_FILL = PatternFill(start_color='2F5496', end_color='2F5496', fill_type='solid')
SUBHEADER_FONT = Font(name='Calibri', bold=True, size=10)
SUBHEADER_FILL = PatternFill(start_color='D6E4F0', end_color='D6E4F0', fill_type='solid')
DATA_FONT = Font(name='Calibri', size=10)
TOTAL_FONT = Font(name='Calibri', bold=True, size=10)
TOTAL_FILL = PatternFill(start_color='E2EFDA', end_color='E2EFDA', fill_type='solid')
THIN_BORDER = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)
CENTER = Alignment(horizontal='center', vertical='center')
LEFT = Alignment(horizontal='left', vertical='center')

def apply_style(cell, font=None, fill=None, alignment=None, border=None, nf=None):
    if font: cell.font = font
    if fill: cell.fill = fill
    if alignment: cell.alignment = alignment
    if border: cell.border = border
    if nf: cell.number_format = nf

# ─────────────────────────────────────────────────────────
# 3. PROGRAMAÇÃO SEMANAL — PREVISTO POR DIA
# ─────────────────────────────────────────────────────────
PREV_HEADER_ROW = 23
PREV_DATE_ROW = 24
PREV_COL_ROW = 25
PREV_DATA_START = 26

# Section header
ws.merge_cells('A23:H23')
ws['A23'] = 'PROGRAMAÇÃO DA SEMANA — META PREVISTA POR DIA'
apply_style(ws['A23'], HEADER_FONT, HEADER_FILL, CENTER, THIN_BORDER)
for c in range(2, 9):
    apply_style(ws.cell(23, c), fill=HEADER_FILL, border=THIN_BORDER)

# Date row (C24-G24 = dates of the week)
ws.cell(PREV_DATE_ROW, 1).value = ''
ws.cell(PREV_DATE_ROW, 2).value = ''
for i, dia in enumerate(['SEG', 'TER', 'QUA', 'QUI', 'SEX']):
    col = 3 + i  # C=3, D=4, E=5, F=6, G=7
    ws.cell(PREV_DATE_ROW, col).value = f'=$B$4+{i}'
    apply_style(ws.cell(PREV_DATE_ROW, col), SUBHEADER_FONT, SUBHEADER_FILL, CENTER, THIN_BORDER, 'DD/MM')
ws.cell(PREV_DATE_ROW, 8).value = ''
apply_style(ws.cell(PREV_DATE_ROW, 8), SUBHEADER_FONT, SUBHEADER_FILL, CENTER, THIN_BORDER)

# Column headers
col_headers = ['Empresa', 'Processo', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'Total Sem']
for i, h in enumerate(col_headers):
    c = ws.cell(PREV_COL_ROW, i + 1)
    c.value = h
    apply_style(c, SUBHEADER_FONT, SUBHEADER_FILL, CENTER, THIN_BORDER)

# Data rows (9 services)
services = [
    ('EJ', 'PREMONTAGEM'),
    ('EJ', 'IÇAMENTO JOIST'),
    ('EJ', 'VIGAS'),
    ('CMM', 'PREMONTAGEM'),
    ('CMM', 'IÇAMENTO JOIST'),
    ('CMM', 'VIGAS'),
    ('GLOBO AÇOS', 'PERFILAÇÃO'),
    ('GLOBO AÇOS', 'TELHAR'),
    ('GLOBO AÇOS', 'FECHAMENTO'),
]

for idx, (empresa, processo) in enumerate(services):
    r = PREV_DATA_START + idx
    ws.cell(r, 1).value = empresa
    ws.cell(r, 2).value = processo
    apply_style(ws.cell(r, 1), DATA_FONT, alignment=LEFT, border=THIN_BORDER)
    apply_style(ws.cell(r, 2), DATA_FONT, alignment=LEFT, border=THIN_BORDER)

    # C-G: Previsto per day (Seg-Sex)
    for day_offset in range(5):
        col = 3 + day_offset
        date_cell = f'{chr(67 + day_offset)}${PREV_DATE_ROW}'  # C$24, D$24, ...
        ws.cell(r, col).value = (
            f"=SUMIFS('CONTROLE KPI'!$G$2:$G${NEW_MAX},"
            f"'CONTROLE KPI'!$A$2:$A${NEW_MAX},{date_cell},"
            f"'CONTROLE KPI'!$C$2:$C${NEW_MAX},$A{r},"
            f"'CONTROLE KPI'!$D$2:$D${NEW_MAX},$B{r})"
        )
        apply_style(ws.cell(r, col), DATA_FONT, alignment=CENTER, border=THIN_BORDER, nf='#,##0')

    # H: Total Semana
    ws.cell(r, 8).value = f'=SUM(C{r}:G{r})'
    apply_style(ws.cell(r, 8), Font(name='Calibri', bold=True, size=10),
                alignment=CENTER, border=THIN_BORDER, nf='#,##0')

# TOTAL row
PREV_TOTAL = PREV_DATA_START + len(services)  # row 35
ws.merge_cells(f'A{PREV_TOTAL}:B{PREV_TOTAL}')
ws.cell(PREV_TOTAL, 1).value = 'TOTAL'
apply_style(ws.cell(PREV_TOTAL, 1), TOTAL_FONT, TOTAL_FILL, CENTER, THIN_BORDER)
for c in range(2, 9):
    apply_style(ws.cell(PREV_TOTAL, c), TOTAL_FONT, TOTAL_FILL, CENTER, THIN_BORDER, '#,##0')

for col in range(3, 9):
    col_letter = chr(64 + col)
    ws.cell(PREV_TOTAL, col).value = f'=SUM({col_letter}{PREV_DATA_START}:{col_letter}{PREV_TOTAL - 1})'

print(f"2/3 Programação Semanal: rows {PREV_HEADER_ROW}-{PREV_TOTAL}")

# ─────────────────────────────────────────────────────────
# 4. ACOMPANHAMENTO DIÁRIO — REALIZADO POR DIA
# ─────────────────────────────────────────────────────────
REAL_HEADER_ROW = PREV_TOTAL + 2  # row 37
REAL_DATE_ROW = REAL_HEADER_ROW + 1  # 38
REAL_COL_ROW = REAL_HEADER_ROW + 2  # 39
REAL_DATA_START = REAL_HEADER_ROW + 3  # 40

# Section header
ws.merge_cells(f'A{REAL_HEADER_ROW}:I{REAL_HEADER_ROW}')
ws.cell(REAL_HEADER_ROW, 1).value = 'ACOMPANHAMENTO DIÁRIO — REALIZADO POR DIA'
apply_style(ws.cell(REAL_HEADER_ROW, 1), HEADER_FONT, HEADER_FILL, CENTER, THIN_BORDER)
for c in range(2, 10):
    apply_style(ws.cell(REAL_HEADER_ROW, c), fill=HEADER_FILL, border=THIN_BORDER)

# Date row
for i in range(5):
    col = 3 + i
    ws.cell(REAL_DATE_ROW, col).value = f'=$B$4+{i}'
    apply_style(ws.cell(REAL_DATE_ROW, col), SUBHEADER_FONT, SUBHEADER_FILL, CENTER, THIN_BORDER, 'DD/MM')

for c in [1, 2, 8, 9]:
    apply_style(ws.cell(REAL_DATE_ROW, c), SUBHEADER_FONT, SUBHEADER_FILL, CENTER, THIN_BORDER)

# Column headers
real_col_headers = ['Empresa', 'Processo', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'Total Real', 'Ating. %']
for i, h in enumerate(real_col_headers):
    c = ws.cell(REAL_COL_ROW, i + 1)
    c.value = h
    apply_style(c, SUBHEADER_FONT, SUBHEADER_FILL, CENTER, THIN_BORDER)

# Data rows
for idx, (empresa, processo) in enumerate(services):
    r = REAL_DATA_START + idx
    prev_r = PREV_DATA_START + idx  # corresponding previsto row

    ws.cell(r, 1).value = empresa
    ws.cell(r, 2).value = processo
    apply_style(ws.cell(r, 1), DATA_FONT, alignment=LEFT, border=THIN_BORDER)
    apply_style(ws.cell(r, 2), DATA_FONT, alignment=LEFT, border=THIN_BORDER)

    # C-G: Realizado per day
    for day_offset in range(5):
        col = 3 + day_offset
        date_cell = f'{chr(67 + day_offset)}${REAL_DATE_ROW}'
        ws.cell(r, col).value = (
            f"=IFERROR(SUMIFS('CONTROLE KPI'!$H$2:$H${NEW_MAX},"
            f"'CONTROLE KPI'!$A$2:$A${NEW_MAX},{date_cell},"
            f"'CONTROLE KPI'!$C$2:$C${NEW_MAX},$A{r},"
            f"'CONTROLE KPI'!$D$2:$D${NEW_MAX},$B{r}),\"\")"
        )
        apply_style(ws.cell(r, col), DATA_FONT, alignment=CENTER, border=THIN_BORDER, nf='#,##0')

    # H: Total Realizado
    ws.cell(r, 8).value = f'=SUM(C{r}:G{r})'
    apply_style(ws.cell(r, 8), Font(name='Calibri', bold=True, size=10),
                alignment=CENTER, border=THIN_BORDER, nf='#,##0')

    # I: Atingimento % (Realizado / Previsto da mesma linha na seção acima)
    ws.cell(r, 9).value = f'=IFERROR(H{r}/H{prev_r},"")'
    apply_style(ws.cell(r, 9), DATA_FONT, alignment=CENTER, border=THIN_BORDER, nf='0%')

# TOTAL row
REAL_TOTAL = REAL_DATA_START + len(services)  # row 49
ws.merge_cells(f'A{REAL_TOTAL}:B{REAL_TOTAL}')
ws.cell(REAL_TOTAL, 1).value = 'TOTAL'
apply_style(ws.cell(REAL_TOTAL, 1), TOTAL_FONT, TOTAL_FILL, CENTER, THIN_BORDER)
for c in range(2, 10):
    apply_style(ws.cell(REAL_TOTAL, c), TOTAL_FONT, TOTAL_FILL, CENTER, THIN_BORDER)

for col in range(3, 9):
    col_letter = chr(64 + col)
    ws.cell(REAL_TOTAL, col).value = f'=SUM({col_letter}{REAL_DATA_START}:{col_letter}{REAL_TOTAL - 1})'
    ws.cell(REAL_TOTAL, col).number_format = '#,##0'

ws.cell(REAL_TOTAL, 9).value = f'=IFERROR(H{REAL_TOTAL}/H{PREV_TOTAL},"")'
ws.cell(REAL_TOTAL, 9).number_format = '0%'

print(f"3/3 Acompanhamento Diário: rows {REAL_HEADER_ROW}-{REAL_TOTAL}")

# ─────────────────────────────────────────────────────────
# 5. FAROL POR DIA (status visual per day per service)
# ─────────────────────────────────────────────────────────
FAROL_HEADER = REAL_TOTAL + 2  # row 51
FAROL_COL_ROW = FAROL_HEADER + 1  # 52
FAROL_DATA_START = FAROL_HEADER + 2  # 53

ws.merge_cells(f'A{FAROL_HEADER}:G{FAROL_HEADER}')
ws.cell(FAROL_HEADER, 1).value = 'STATUS DIÁRIO — FAROL POR DIA'
apply_style(ws.cell(FAROL_HEADER, 1), HEADER_FONT, HEADER_FILL, CENTER, THIN_BORDER)
for c in range(2, 8):
    apply_style(ws.cell(FAROL_HEADER, c), fill=HEADER_FILL, border=THIN_BORDER)

farol_cols = ['Empresa', 'Processo', 'SEG', 'TER', 'QUA', 'QUI', 'SEX']
for i, h in enumerate(farol_cols):
    c = ws.cell(FAROL_COL_ROW, i + 1)
    c.value = h
    apply_style(c, SUBHEADER_FONT, SUBHEADER_FILL, CENTER, THIN_BORDER)

for idx, (empresa, processo) in enumerate(services):
    r = FAROL_DATA_START + idx
    prev_r = PREV_DATA_START + idx
    real_r = REAL_DATA_START + idx

    ws.cell(r, 1).value = empresa
    ws.cell(r, 2).value = processo
    apply_style(ws.cell(r, 1), DATA_FONT, alignment=LEFT, border=THIN_BORDER)
    apply_style(ws.cell(r, 2), DATA_FONT, alignment=LEFT, border=THIN_BORDER)

    for day_offset in range(5):
        col = 3 + day_offset
        col_letter = chr(67 + day_offset)
        prev_cell = f'{col_letter}{prev_r}'
        real_cell = f'{col_letter}{real_r}'
        ws.cell(r, col).value = (
            f'=IF(NOT(ISNUMBER({prev_cell})),"—",'
            f'IF({prev_cell}=0,"—",'
            f'IF(NOT(ISNUMBER({real_cell})),"PENDENTE",'
            f'IF({real_cell}>={prev_cell},"VERDE",'
            f'IF({real_cell}>={prev_cell}*0.9,"AMARELO","VERMELHO")))))'
        )
        apply_style(ws.cell(r, col), DATA_FONT, alignment=CENTER, border=THIN_BORDER)

FAROL_END = FAROL_DATA_START + len(services) - 1
print(f"   Farol Diário: rows {FAROL_HEADER}-{FAROL_END}")

# ─────────────────────────────────────────────────────────
# 6. Legenda + instrução
# ─────────────────────────────────────────────────────────
LEG_ROW = FAROL_END + 2
ws.merge_cells(f'A{LEG_ROW}:G{LEG_ROW}')
ws.cell(LEG_ROW, 1).value = (
    'VERDE = ≥100% | AMARELO = 90-99% | VERMELHO = <90% | '
    'PENDENTE = sem apontamento | — = sem meta/fim de semana'
)
apply_style(ws.cell(LEG_ROW, 1), Font(name='Calibri', italic=True, size=9, color='4472C4'))

# ─────────────────────────────────────────────────────────
# 7. Column widths
# ─────────────────────────────────────────────────────────
ws.column_dimensions['A'].width = 14
ws.column_dimensions['B'].width = 18
for col_letter in ['C', 'D', 'E', 'F', 'G']:
    ws.column_dimensions[col_letter].width = 10
ws.column_dimensions['H'].width = 12
ws.column_dimensions['I'].width = 10

# ─────────────────────────────────────────────────────────
# Save
# ─────────────────────────────────────────────────────────
wb.save(DST)
print(f"\nSalvo: {DST}")
print(f"\nRESUMO:")
print(f"  B4 = =B3-WEEKDAY(B3,2)+1 (segunda-feira automática)")
print(f"  B5 = =B3-WEEKDAY(B3,2)+5 (sexta-feira automática)")
print(f"  Programação Semanal (Previsto por dia): rows {PREV_HEADER_ROW}-{PREV_TOTAL}")
print(f"  Acompanhamento Diário (Realizado por dia): rows {REAL_HEADER_ROW}-{REAL_TOTAL}")
print(f"  Status Diário (Farol): rows {FAROL_HEADER}-{FAROL_END}")
print(f"  Legenda: row {LEG_ROW}")
