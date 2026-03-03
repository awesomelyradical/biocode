/**
 * Fixed-size spatial hash grid for fast proximity queries.
 * Rebuild every tick — insertion is O(n), queries check only nearby cells.
 */
export class SpatialGrid<T> {
  private cells: Map<number, T[]> = new Map()
  private cellSize: number
  private invCellSize: number
  private cols: number

  constructor(cellSize: number, worldSize: number) {
    this.cellSize = cellSize
    this.invCellSize = 1 / cellSize
    this.cols = Math.ceil(worldSize / cellSize) + 1
  }

  clear() {
    this.cells.clear()
  }

  insert(x: number, y: number, item: T) {
    const col = (x * this.invCellSize) | 0
    const row = (y * this.invCellSize) | 0
    const key = row * this.cols + col
    const cell = this.cells.get(key)
    if (cell) cell.push(item)
    else this.cells.set(key, [item])
  }

  /** Return all items whose cell is within `radius` of (x, y). */
  query(x: number, y: number, radius: number, out: T[] = []): T[] {
    const minCol = ((x - radius) * this.invCellSize) | 0
    const maxCol = ((x + radius) * this.invCellSize) | 0
    const minRow = ((y - radius) * this.invCellSize) | 0
    const maxRow = ((y + radius) * this.invCellSize) | 0

    for (let row = minRow; row <= maxRow; row++) {
      const rowOffset = row * this.cols
      for (let col = minCol; col <= maxCol; col++) {
        const cell = this.cells.get(rowOffset + col)
        if (cell) {
          for (let k = 0; k < cell.length; k++) {
            out.push(cell[k]!)
          }
        }
      }
    }
    return out
  }
}
