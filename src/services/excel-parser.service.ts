import * as XLSX from 'xlsx';
import mongoose from 'mongoose';
import { Order } from '../models/Order.model.js';
import { DeptValidOrders } from '../models/DeptValidOrders.model.js';
import { formatExcelDate } from '../utils/excel-date.js';
import { buildKeyMap, getVal } from '../utils/normalizer.js';
import { StatusEngineService } from './status-engine.service.js';

export class ExcelParserService {
  /**
   * Reads an uploaded Excel file from GridFS and updates the Order collection
   */
  static async parseAndStoreExcel(
    savedName: string,
    category: string,
    bucket: mongoose.mongo.GridFSBucket
  ): Promise<void> {
    const chunks: Buffer[] = [];
    const stream = bucket.openDownloadStreamByName(savedName);

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    const buf = Buffer.concat(chunks);
    const wb = XLSX.read(buf, { type: 'buffer' });
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

    const itemsField = `${dept}Items`;
    const bulkOps: any[] = [];

    for (const [orderNo, items] of Object.entries(orderItems)) {
      const update: Record<string, any> = { [itemsField]: items };

      // Infer buyer from first fabric row if available
      if (items.length > 0) {
        const km = buildKeyMap(items[0]);
        const buyer = String(getVal(items[0], ['Buyer', 'BuyerName', 'Customer'], km))
          .trim()
          .toUpperCase()
          .replace(/\s+/g, ' ');
        if (buyer && buyer !== 'UNDEFINED' && buyer !== 'N/A' && buyer !== '') {
          update.buyer = buyer;
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

    if (bulkOps.length > 0) {
      for (let i = 0; i < bulkOps.length; i += 500) {
        await Order.bulkWrite(bulkOps.slice(i, i + 500), { ordered: false });
      }
      console.log(`✅ ${dept}: ${bulkOps.length} orders updated with fabric items.`);
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
}
