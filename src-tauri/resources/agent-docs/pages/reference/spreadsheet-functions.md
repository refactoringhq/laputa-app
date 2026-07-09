# Spreadsheet Formulas

Source: reference/spreadsheet-functions.md
URL: /reference/spreadsheet-functions

# Spreadsheet Formulas

Formula cells start with `=` and are evaluated by IronCalc through Tolaria's sheet editor.

Tolaria adds vault-aware sheet references on top of the normal spreadsheet formula model. Everything else should be treated as IronCalc formula behavior. IronCalc aims for Excel-compatible formulas, but the upstream project is still evolving, so verify advanced formulas against the IronCalc docs when precision matters.

The same `[[note]].field` target forms are also available to HTML block vault expressions. Use [Vault Expressions](/reference/vault-expressions) for `{{...}}` syntax and HTML formatting helpers.

## Basic Syntax

| Syntax | Meaning |
| --- | --- |
| `=B2+B3-B4` | Arithmetic over cells. |
| `=SUM(B2:D2)` | Function call over a range. |
| `=ROUND(E6, 2)` | Function call with arguments. |
| `=IF(E6>0, "Up", "Down")` | Conditional expression. |
| `=$B$2` | Absolute column and row reference. |
| `=B$2` | Relative column, absolute row. |
| `=$B2` | Absolute column, relative row. |
| `=B2:D10` | A range in the current sheet note. |
| `="Q" & 1` | Text concatenation. |

Use parentheses when a model depends on precedence:

```txt
=(B2+B3-B4)/B5
```

## Tolaria Note References

Tolaria supports wikilink cell references for values that live in another sheet note:

```txt
=[[newsletter-revenue]].B5
=SUM(B2:D2)+[[sponsorship-pipeline]].E12
=ROUND([[business-plan]].$E$12, 2)
=[[launch-brief]].2
```

The target inside `[[...]]` resolves like a normal Tolaria wikilink. The cell address after the dot uses A1 notation.

Absolute markers follow spreadsheet copy behavior:

| Reference | Copy behavior |
| --- | --- |
| `[[revenue]].B5` | row and column can shift |
| `[[revenue]].$B$5` | row and column stay fixed |
| `[[revenue]].B$5` | row fixed, column can shift |
| `[[revenue]].$B5` | column fixed, row can shift |

Cross-sheet cell references currently resolve single cells. Keep range formulas inside one sheet note until cross-note ranges are explicitly supported.

Formulas can also read scalar frontmatter properties from a specific note:

```txt
=[[device.md]].power.watts
=[[project-alpha]].status
=[[book-notes/the-design-of-everyday-things.md]].rating
```

The target resolves like a wikilink, and the dot path reads nested frontmatter keys. Numbers, booleans, and strings become formula literals. Missing notes, ambiguous note targets, missing properties, arrays, maps, and other non-scalar values resolve to `#N/A`.

A first segment that looks like an A1 cell address, such as `B2`, is treated as a cross-sheet cell reference. Use property names that do not collide with A1 notation for frontmatter formulas.

Formulas can read one raw Markdown body line from any note with numeric dot notation:

```txt
=[[launch-brief]].1
=[[launch-brief]].2
```

Line references exclude YAML frontmatter, are 1-based, and preserve commas as text. `[[note]].A1` still means grid/cell access and can split comma-separated content; `[[note]].1` means the whole first body line.

## Autocomplete Functions

Tolaria's formula autocomplete exposes the implemented function catalog from the bundled IronCalc engine. The current catalog has 195 functions.

The dropdown shows a small ranked set of matches while you type. Keep typing to narrow the result list. Function names with digits and dots, such as `BIN2DEC` and `ERFC.PRECISE`, are supported.

### Logical

`AND`, `FALSE`, `IF`, `IFERROR`, `IFNA`, `IFS`, `NOT`, `OR`, `SWITCH`, `TRUE`, `XOR`

### Math and trigonometry

`ABS`, `ACOS`, `ACOSH`, `ASIN`, `ASINH`, `ATAN`, `ATAN2`, `ATANH`, `COS`, `COSH`, `PI`, `POWER`, `PRODUCT`, `RAND`, `RANDBETWEEN`, `ROUND`, `ROUNDDOWN`, `ROUNDUP`, `SIN`, `SINH`, `SQRT`, `SQRTPI`, `SUM`, `SUMIF`, `SUMIFS`, `TAN`, `TANH`, `SUBTOTAL`

### Lookup and reference

`CHOOSE`, `COLUMN`, `COLUMNS`, `HLOOKUP`, `INDEX`, `INDIRECT`, `LOOKUP`, `MATCH`, `OFFSET`, `ROW`, `ROWS`, `VLOOKUP`, `XLOOKUP`

### Text

`CONCAT`, `CONCATENATE`, `EXACT`, `FIND`, `LEFT`, `LEN`, `LOWER`, `MID`, `REPT`, `RIGHT`, `SEARCH`, `SUBSTITUTE`, `T`, `TEXT`, `TEXTAFTER`, `TEXTBEFORE`, `TEXTJOIN`, `TRIM`, `UNICODE`, `UPPER`, `VALUE`, `VALUETOTEXT`

### Information

`ERROR.TYPE`, `FORMULATEXT`, `ISBLANK`, `ISERR`, `ISERROR`, `ISEVEN`, `ISFORMULA`, `ISLOGICAL`, `ISNA`, `ISNONTEXT`, `ISNUMBER`, `ISODD`, `ISREF`, `ISTEXT`, `NA`, `SHEET`, `TYPE`

### Statistical

`AVERAGE`, `AVERAGEA`, `AVERAGEIF`, `AVERAGEIFS`, `COUNT`, `COUNTA`, `COUNTBLANK`, `COUNTIF`, `COUNTIFS`, `GEOMEAN`, `MAX`, `MAXIFS`, `MIN`, `MINIFS`

### Date and time

`DATE`, `DAY`, `EDATE`, `EOMONTH`, `MONTH`, `NOW`, `TODAY`, `YEAR`

### Financial

`CUMIPMT`, `CUMPRINC`, `DB`, `DDB`, `DOLLARDE`, `DOLLARFR`, `EFFECT`, `FV`, `IPMT`, `IRR`, `ISPMT`, `MIRR`, `NOMINAL`, `NPER`, `NPV`, `PDURATION`, `PMT`, `PPMT`, `PV`, `RATE`, `RRI`, `SLN`, `SYD`, `TBILLEQ`, `TBILLPRICE`, `TBILLYIELD`, `XIRR`, `XNPV`

### Engineering

`BESSELI`, `BESSELJ`, `BESSELK`, `BESSELY`, `BIN2DEC`, `BIN2HEX`, `BIN2OCT`, `BITAND`, `BITLSHIFT`, `BITOR`, `BITRSHIFT`, `BITXOR`, `COMPLEX`, `CONVERT`, `DEC2BIN`, `DEC2HEX`, `DEC2OCT`, `DELTA`, `ERF`, `ERF.PRECISE`, `ERFC`, `ERFC.PRECISE`, `GESTEP`, `HEX2BIN`, `HEX2DEC`, `HEX2OCT`, `IMABS`, `IMAGINARY`, `IMARGUMENT`, `IMCONJUGATE`, `IMCOS`, `IMCOSH`, `IMCOT`, `IMCSC`, `IMCSCH`, `IMDIV`, `IMEXP`, `IMLN`, `IMLOG10`, `IMLOG2`, `IMPOWER`, `IMPRODUCT`, `IMREAL`, `IMSEC`, `IMSECH`, `IMSIN`, `IMSINH`, `IMSQRT`, `IMSUB`, `IMSUM`, `IMTAN`, `OCT2BIN`, `OCT2DEC`, `OCT2HEX`

## Examples

### Totals

```txt
=SUM(B2:D2)
=B2+B3-B4
=SUM(B2:D2)-SUM(B4:D4)
```

### Growth And Percentages

```txt
=(C5-B5)/B5
=IF(B5=0, 0, (C5-B5)/B5)
=ROUND((C5-B5)/B5, 4)
```

Format the result as a percentage with a cell `num_fmt` such as `0.00%`.

### Conditional Logic

```txt
=IF(E5>10000, "On track", "Review")
=IFS(E5>10000, "High", E5>5000, "Medium", TRUE, "Low")
=IFERROR(B5/B4, 0)
```

### Dates

```txt
=TODAY()
=DATE(2026, 6, 15)
=YEAR(TODAY())
=MONTH(TODAY())
```

### Text

```txt
=CONCAT(A2, " - ", B2)
=UPPER(A2)
=TRIM(A2)
=TEXT(B2, "$#,##0.00")
```

### Lookup

```txt
=INDEX(B2:E10, 3, 2)
=MATCH("Revenue", A2:A20, 0)
=VLOOKUP("Revenue", A2:E20, 5, FALSE)
=XLOOKUP("Revenue", A2:A20, E2:E20)
```

### Cross-Sheet Model

```txt
=[[newsletter-revenue]].E5
=SUM(B2:D2)+[[sponsorship-pipeline]].E12
=IF([[business-plan]].$E$12>0, [[business-plan]].$E$12, 0)
=[[launch-brief]].2
```

## IronCalc Function Families

IronCalc documents formulas by category. Use these upstream pages for detailed syntax and examples. The upstream documentation may include newer functions that are not yet present in Tolaria's bundled IronCalc version.

| Family | Link |
| --- | --- |
| Lookup and reference | [IronCalc lookup and reference](https://docs.ironcalc.com/functions/lookup-and-reference.html) |
| Financial | [IronCalc financial](https://docs.ironcalc.com/functions/financial.html) |
| Engineering | [IronCalc engineering](https://docs.ironcalc.com/functions/engineering.html) |
| Database | [IronCalc database](https://docs.ironcalc.com/functions/database.html) |
| Statistical | [IronCalc statistical](https://docs.ironcalc.com/functions/statistical.html) |
| Text | [IronCalc text](https://docs.ironcalc.com/functions/text.html) |
| Math and trigonometry | [IronCalc math and trigonometry](https://docs.ironcalc.com/functions/math-and-trigonometry.html) |
| Logical | [IronCalc logical](https://docs.ironcalc.com/functions/logical.html) |
| Date and time | [IronCalc date and time](https://docs.ironcalc.com/functions/date-and-time.html) |
| Information | [IronCalc information](https://docs.ironcalc.com/functions/information.html) |

IronCalc also documents [value types](https://docs.ironcalc.com/features/value-types.html), [error types](https://docs.ironcalc.com/features/error-types.html), [optional arguments](https://docs.ironcalc.com/features/optional-arguments.html), and [formatting values](https://docs.ironcalc.com/features/formatting-values.html).

For current upstream gaps, see IronCalc's [unsupported features](https://docs.ironcalc.com/features/unsupported-features.html).