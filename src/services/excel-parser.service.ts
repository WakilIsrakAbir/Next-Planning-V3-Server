import * as XLSX from 'xlsx';
import fs from 'fs';
import mongoose from 'mongoose';
import { Order } from '../models/Order.model.js';
import { OrderDate } from '../models/OrderDate.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';
import { BatchBpData } from '../models/BatchBpData.model.js';
import { bpHeaderError, groupBpRows } from '../lib/batch/source.js';
import { formatExcelDate } from '../utils/excel-date.js';
import { buildKeyMap, getVal } from '../utils/normalizer.js';
import { buildPlanMap, findMatchingPlan, generateBackendItemId } from '../utils/item-matching.js';
import { StatusEngineService } from './status-engine.service.js';

// A department file only replaces an order's buyer when it is empty or one of these placeholders.
const PLACEHOLDER_BUYERS = ['PENDING', 'UNKNOWN', 'GENERAL'];

export class ExcelParserService {
  /**
   * Reads an uploaded Excel file from GridFS and updates the Order collection.
   * BP Data files (category 'BP') go to the BatchBpData collection instead, never into Order.
   */
  static async parseAndStoreExcel(
    savedName: string,
    category: string,
    bucket: mongoose.mongo.GridFSBucket,
    originalName = ''
  ): Promise<void> {
    const chunks: Buffer[] = [];
    const stream = bucket.openDownloadStreamByName(savedName);

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    const buf = Buffer.concat(chunks);
    const wb = XLSX.read(buf, { type: 'buffer' });

    // Batch Plan module: BP Data goes to its own collection, never into Order.
    if (String(category || '') === 'BP') {
      await this.processBpFile(wb, originalName || savedName);
      return;
    }

    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const sheetData: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!sheetData || sheetData.length === 0) return;

    const cat = (category || 'General').toLowerCase();

    if (cat === 'general') {
      await this.processGeneralFile(sheetData, sheet);
    } else {
      const deptMap: Record<string, string> = {
        yd: 'yd',
        knitting: 'knitting',
        dyeing: 'dyeing',
        finishing: 'finishing',
        delivery: 'delivery',
      };
      const dept = deptMap[cat] || cat;
      await this.processDeptFile(sheetData, dept);
    }

    // Synchronize saved plans with updated order items
    await StatusEngineService.recalcAllPlanStatuses();
  }

  private static async processGeneralFile(sheetData: any[], sheet: any): Promise<void> {
    const bulkOps: any[] = [];
    const validOrderNos: string[] = [];

    // Map column letters directly (A, D, E, U, V, W, Y, Z, AA-AH)
    const colMapByOrderNo = new Map<string, any>();
    if (sheet) {
      try {
        const colRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: '' });
        for (let i = 1; i < colRows.length; i++) {
          const oNo = String(colRows[i]['A'] ?? '').trim();
          if (oNo && oNo !== 'undefined' && !colMapByOrderNo.has(oNo)) {
            colMapByOrderNo.set(oNo, colRows[i]);
          }
        }
      } catch (err: any) {
        console.error('Error parsing column-letter rows in General file:', err.message);
      }
    }

    for (const row of sheetData) {
      const km = buildKeyMap(row);
      const orderNo = String(
        getVal(row, ['OrderNo', 'BookingNo', 'EWO', 'Booking', 'Order No', 'Booking No'], km)
      ).trim();

      if (!orderNo || orderNo === 'undefined') continue;
      validOrderNos.push(orderNo);

      const colRow = colMapByOrderNo.get(orderNo) || {};

      const buyer = String(getVal(row, ['Buyer', 'BuyerName', 'Customer'], km))
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');

      const bookingDate = formatExcelDate(
        getVal(row, ['BookingReceiveDate', 'BookingDate', 'Date'], km)
      );

      const gmtUnit = String(
        colRow['U'] !== undefined && colRow['U'] !== ''
          ? colRow['U']
          : getVal(row, ['BookingUnit', 'Booking Unit', 'GmtUnit', 'Gmt Unit'], km)
      ).trim();

      const floor = String(
        colRow['V'] !== undefined && colRow['V'] !== ''
          ? colRow['V']
          : getVal(row, ['Unit', 'Floor'], km)
      ).trim();

      const buyerTeam = String(
        colRow['W'] !== undefined && colRow['W'] !== ''
          ? colRow['W']
          : getVal(row, ['BuyerTeam', 'Buyer Team'], km)
      ).trim();

      const bookedBy = String(
        colRow['D'] !== undefined && colRow['D'] !== ''
          ? colRow['D']
          : getVal(row, ['BookingBy', 'BookedBy', 'Booked By', 'Booking By'], km)
      ).trim();

      const style = String(
        colRow['Y'] !== undefined && colRow['Y'] !== ''
          ? colRow['Y']
          : getVal(row, ['Style'], km)
      ).trim();

      const bpStatusRaw =
        colRow['Z'] !== undefined && colRow['Z'] !== ''
          ? colRow['Z']
          : getVal(row, ['BPStatus', 'BP Status'], km);
      const bpStatus = formatExcelDate(bpStatusRaw);

      const pmc = String(
        colRow['E'] !== undefined && colRow['E'] !== ''
          ? colRow['E']
          : getVal(row, ['PMC'], km)
      ).trim();

      const brush = String(
        colRow['AA'] !== undefined && colRow['AA'] !== ''
          ? colRow['AA']
          : getVal(row, ['Brush'], km)
      ).trim();

      const peach = String(
        colRow['AB'] !== undefined && colRow['AB'] !== ''
          ? colRow['AB']
          : getVal(row, ['Peach'], km)
      ).trim();

      const bodyFabric = String(
        colRow['AC'] !== undefined && colRow['AC'] !== ''
          ? colRow['AC']
          : getVal(row, ['Body Fabric', 'BodyFabric', 'Fabric'], km)
      ).trim();

      const programType = String(
        colRow['AD'] !== undefined && colRow['AD'] !== ''
          ? colRow['AD']
          : getVal(row, ['Program type', 'Program Type', 'ProgramType'], km)
      ).trim();

      const ald = String(
        colRow['AE'] !== undefined && colRow['AE'] !== ''
          ? colRow['AE']
          : getVal(row, ['ALD'], km)
      ).trim();

      const bodyGsm =
        colRow['AF'] !== undefined && colRow['AF'] !== ''
          ? colRow['AF']
          : getVal(row, ['Body GSM', 'BodyGSM', 'GSM'], km);

      const heatset = String(
        colRow['AG'] !== undefined && colRow['AG'] !== ''
          ? colRow['AG']
          : getVal(row, ['Heatset'], km)
      ).trim();

      const pmcNotes = String(
        colRow['AH'] !== undefined && colRow['AH'] !== ''
          ? colRow['AH']
          : getVal(row, ['PMC Notes', 'PMCNotes'], km)
      ).trim();

      const updateData = {
        buyer: buyer && buyer !== 'UNDEFINED' && buyer !== 'N/A' ? buyer : '',
        bookingDate,
        requiredQtyKgs: getVal(row, ['RequiredQtyKgs', 'Qty', 'Order Qty'], km),
        bookingBy: bookedBy,
        bookedBy,
        pmc,
        finalConfirmation: String(
          getVal(row, ['FinalConfirmation', 'Final Confirmation', 'Status'], km)
        ),
        eventDay: getVal(row, ['EventDay', 'Event day'], km),
        ship1: formatExcelDate(getVal(row, ['1stShipmentDate', '1st Shipment Date', 'Ship1'], km)),
        shipLast: formatExcelDate(
          getVal(row, ['LastShipmentDate', 'Last Shipment Date', 'ShipLast'], km)
        ),
        yarnDate: formatExcelDate(
          getVal(row, ['TAYarnDate', 'T&A Yarn date', 'YarnDate'], km)
        ),
        knitStart: formatExcelDate(
          getVal(row, ['TAKnittingStart', 'T&A Knitting Start', 'KnitStart'], km)
        ),
        knitEnd: formatExcelDate(
          getVal(row, ['TAKnittingEnd', 'T&A Knitting End', 'KnitEnd'], km)
        ),
        dyeStart: formatExcelDate(
          getVal(row, ['TADyeingStart', 'T&A Dyeing Start', 'DyeStart'], km)
        ),
        dyeEnd: formatExcelDate(
          getVal(row, ['TADyeingEnd', 'T&A Dyeing End', 'DyeEnd'], km)
        ),
        deliStart: formatExcelDate(
          getVal(row, ['TADeliStart', 'T&A Deli. Start', 'DeliStart'], km)
        ),
        deliEnd: formatExcelDate(
          getVal(row, ['TADeliEnd', 'T&A Deli. End', 'DeliEnd'], km)
        ),
        fabricNotes: String(getVal(row, ['FabricNotes', 'Fabric Notes', 'Notes'], km)),
        status: String(getVal(row, ['Status'], km)),
        gmtUnit,
        floor,
        buyerTeam,
        style,
        bpStatus,
        ald,
        brush,
        peach,
        heatset,
        bodyFabric,
        programType,
        bodyGsm,
        pmcNotes,
      };

      bulkOps.push({
        updateOne: {
          filter: { orderNo },
          update: { $set: updateData },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      for (let i = 0; i < bulkOps.length; i += 500) {
        await Order.bulkWrite(bulkOps.slice(i, i + 500), { ordered: false });
      }
      console.log(`✅ General: ${bulkOps.length} orders upserted.`);
    }

    if (validOrderNos.length > 0) {
      await DeptValidOrders.findOneAndUpdate(
        { dept: 'general' },
        { $set: { validOrderNos, updatedAt: new Date() } },
        { upsert: true }
      );
      console.log(`✅ General: ${validOrderNos.length} valid order numbers tracked.`);
    }
  }

  private static async processDeptFile(sheetData: any[], dept: string): Promise<void> {
    const orderItems: Record<string, any[]> = {};

    for (const row of sheetData) {
      const km = buildKeyMap(row);
      const orderNo = String(
        getVal(row, ['OrderNo', 'BookingNo', 'EWO', 'Booking', 'Order No', 'Booking No'], km)
      ).trim();

      if (!orderNo || orderNo === 'undefined') continue;

      // Clean row: remove temporary empty keys
      const cleanRow: Record<string, any> = {};
      for (const key in row) {
        if (!key.startsWith('__EMPTY') && key !== '_fileIndex') {
          cleanRow[key] = row[key];
        }
      }

      if (!orderItems[orderNo]) orderItems[orderNo] = [];
      orderItems[orderNo].push(cleanRow);
    }

    const orderNos = Object.keys(orderItems);
    if (orderNos.length === 0) return;

    // Fetch existing OrderDate docs for all orderNos in this file to synchronize saved plans
    const orderDateDocs = await OrderDate.find({ orderNo: { $in: orderNos } }).lean();
    const odMap = new Map<string, any>();
    orderDateDocs.forEach((doc: any) => odMap.set(doc.orderNo, doc));

    const orderDateBulkOps: any[] = [];
    const itemsField = `${dept}Items`;
    const bulkOps: any[] = [];
    const buyerFillOps: any[] = [];

    for (const [orderNo, items] of Object.entries(orderItems)) {
      const existingOd = odMap.get(orderNo);
      const existingPlans: any[] = existingOd && Array.isArray(existingOd[dept]) ? existingOd[dept] : [];
      let deptPlanStatus = 'Pending';

      if (existingPlans.length > 0) {
        const planMap = buildPlanMap(existingPlans, dept, orderNo);

        const syncedPlans: any[] = [];
        let hasPending = false;
        let hasTentative = false;
        let confirmCount = 0;
        let matchCount = 0;

        items.forEach((item, idx) => {
          const itemId = generateBackendItemId(item, dept, orderNo) || `item_${idx}`;
          const saved = findMatchingPlan(planMap, item, dept, orderNo);

          if (saved) {
            matchCount++;
            const cleanType = String(
              dept === 'delivery' ? saved.floorPlanType || saved.planType || '' : saved.planType || ''
            ).trim();
            if (!cleanType || cleanType === 'Select' || cleanType === 'Pending') {
              hasPending = true;
            } else if (cleanType === 'Tentative') {
              hasTentative = true;
            } else if (cleanType === 'Confirm') {
              confirmCount++;
            } else {
              hasPending = true;
            }

            // Preserve user-entered attributes from the saved itemData
            const existingItemData = saved.itemData || {};
            const mergedItemData: Record<string, any> = { ...item };

            if (existingItemData.Unit) mergedItemData.Unit = existingItemData.Unit;
            if (existingItemData.ProcessName) {
              mergedItemData.ProcessName = existingItemData.ProcessName;
              mergedItemData['Process Name'] = existingItemData.ProcessName;
            } else if (existingItemData['Process Name']) {
              mergedItemData['Process Name'] = existingItemData['Process Name'];
              mergedItemData.ProcessName = existingItemData['Process Name'];
            }
            if (existingItemData['Barrier Qty.'] !== undefined && existingItemData['Barrier Qty.'] !== '') {
              mergedItemData['Barrier Qty.'] = existingItemData['Barrier Qty.'];
            }
            if (existingItemData['Workable Qty.'] !== undefined && existingItemData['Workable Qty.'] !== '') {
              mergedItemData['Workable Qty.'] = existingItemData['Workable Qty.'];
            }

            syncedPlans.push({
              ...saved,
              itemId,
              itemData: mergedItemData,
              startDate: saved.startDate || '',
              endDate: saved.endDate || '',
              planType: saved.planType || '',
              limitation: saved.limitation || '',
              remarks: saved.remarks || '',
              floorStartDate: saved.floorStartDate || '',
              floorEndDate: saved.floorEndDate || '',
              floorPlanType: saved.floorPlanType || '',
              yarnDate: saved.yarnDate || '',
              yarnOkDate: saved.yarnOkDate || '',
              matchingOptionDate: saved.matchingOptionDate || '',
            });
          } else {
            // Brand new item added from Excel: treat as Pending so the planner can plan it
            hasPending = true;

            syncedPlans.push({
              itemId,
              itemData: item,
              startDate: '',
              endDate: '',
              planType: '',
              limitation: '',
              remarks: '',
              floorStartDate: '',
              floorEndDate: '',
              floorPlanType: '',
              yarnDate: '',
              yarnOkDate: '',
              matchingOptionDate: '',
            });
          }
        });

        if (hasPending || matchCount === 0) {
          deptPlanStatus = 'Pending';
        } else if (hasTentative) {
          deptPlanStatus = 'Tentative';
        } else if (confirmCount === items.length && items.length > 0) {
          deptPlanStatus = 'Confirm';
        } else {
          deptPlanStatus = 'Pending';
        }

        // CRITICAL SAFETY: never wipe out existing plans when no item matched
        if (matchCount === 0 && existingPlans.length > 0) {
          console.warn(
            `[WARN] No items matched for order ${orderNo} (${dept}). Preserving existing plans to avoid data loss.`
          );
        } else {
          orderDateBulkOps.push({
            updateOne: {
              filter: { orderNo },
              update: { $set: { [dept]: syncedPlans } },
              upsert: true,
            },
          });
        }
      }

      const update: Record<string, any> = {
        [itemsField]: items,
        [`${dept}PlanStatus`]: deptPlanStatus,
      };

      // Buyer from the first item. It only fills an order that has no real buyer yet (empty, or a
      // placeholder such as "PENDING"), so the General file's buyer is never replaced by a
      // department file. Applied after the item update.
      if (items.length > 0) {
        const km = buildKeyMap(items[0]);
        const buyer = String(getVal(items[0], ['Buyer', 'BuyerName', 'Customer'], km))
          .trim()
          .toUpperCase()
          .replace(/\s+/g, ' ');
        if (buyer && buyer !== 'UNDEFINED' && buyer !== 'N/A' && buyer !== '') {
          buyerFillOps.push({
            updateOne: {
              filter: {
                orderNo,
                $or: [
                  { buyer: { $exists: false } },
                  { buyer: null },
                  { buyer: '' },
                  { buyer: { $in: PLACEHOLDER_BUYERS } },
                ],
              },
              update: { $set: { buyer } },
            },
          });
        }
      }

      bulkOps.push({
        updateOne: {
          filter: { orderNo },
          update: { $set: update },
          upsert: true,
        },
      });
    }

    if (orderDateBulkOps.length > 0) {
      for (let i = 0; i < orderDateBulkOps.length; i += 500) {
        await OrderDate.bulkWrite(orderDateBulkOps.slice(i, i + 500), { ordered: false });
      }
      console.log(`✅ ${dept}: ${orderDateBulkOps.length} OrderDate docs synchronized with current items.`);
    }

    if (bulkOps.length > 0) {
      for (let i = 0; i < bulkOps.length; i += 500) {
        await Order.bulkWrite(bulkOps.slice(i, i + 500), { ordered: false });
      }
      console.log(`✅ ${dept}: ${bulkOps.length} orders updated with fabric items.`);
    }

    if (buyerFillOps.length > 0) {
      for (let i = 0; i < buyerFillOps.length; i += 500) {
        await Order.bulkWrite(buyerFillOps.slice(i, i + 500), { ordered: false });
      }
    }

    const validOrderNos = Object.keys(orderItems);
    if (validOrderNos.length > 0) {
      await DeptValidOrders.findOneAndUpdate(
        { dept },
        { $set: { validOrderNos, updatedAt: new Date() } },
        { upsert: true }
      );
      console.log(`✅ ${dept}: ${validOrderNos.length} valid order numbers tracked.`);
    }
  }

  /* ---------------- Batch Plan module: BP Data ---------------- */

  /**
   * Reads the BP Data rows (sheet "BP Data", else the first sheet) and checks the headers.
   * `error` is the message shown to the user, '' when the file is usable.
   */
  static readBpRows(wb: XLSX.WorkBook): { rows: any[]; error: string } {
    const sheetName = wb.Sheets['BP Data'] ? 'BP Data' : wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return { rows: [], error: 'Could not find the BP Data sheet.' };
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const headerError = bpHeaderError(rows);
    if (headerError) return { rows, error: headerError };
    if (!groupBpRows(rows).size) {
      return { rows, error: 'No booking records found. Check that the sheet has an OrderNo column.' };
    }
    return { rows, error: '' };
  }

  /** Checks an uploaded BP Data file on disk before it is stored. Returns the error message or ''. */
  static bpFileError(filePath: string): string {
    try {
      // Same as the old XLSX.readFile(path); reading the buffer here does not depend on XLSX's own fs hook.
      return this.readBpRows(XLSX.read(fs.readFileSync(filePath), { type: 'buffer' })).error;
    } catch (readErr: any) {
      return 'Sheet parsing error: ' + readErr.message;
    }
  }

  /**
   * Stores BP Data rows. Orders in the new file replace their old rows; rows previously uploaded
   * from a file with the same name (owner = lower-case file name) are removed; other files' rows stay.
   */
  static async processBpFile(wb: XLSX.WorkBook, fileName: string): Promise<void> {
    const { rows, error } = this.readBpRows(wb);
    if (error) throw new Error(error);
    const owner = String(fileName || '').toLowerCase();
    const grouped = groupBpRows(rows);
    const keys = Array.from(grouped.keys());
    await BatchBpData.deleteMany({ $or: [{ orderKey: { $in: keys } }, ...(owner ? [{ owner }] : [])] });
    const docs: { orderKey: string; orderNo: string; owner: string; row: Record<string, any> }[] = [];
    for (const [orderKey, group] of grouped) {
      for (const row of group.rows) docs.push({ orderKey, orderNo: group.orderNo, owner, row });
    }
    for (let i = 0; i < docs.length; i += 1000) {
      await BatchBpData.insertMany(docs.slice(i, i + 1000), { ordered: false });
    }
    console.log(`✅ BP Data: ${docs.length} rows for ${keys.length} orders stored.`);
  }
}
