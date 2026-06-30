import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";

/**
 * Generates an ATS-friendly PDF from optimized resume JSON.
 * @param {object} optimizedJson - The AI generated resume JSON
 * @returns {Promise<Buffer>} The PDF buffer
 */
export async function generatePdf(optimizedJson) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const { contact = {}, summary = "", experience = [], education = [], skills = {} } = optimizedJson;

      // Contact Header
      doc.fontSize(20).font("Helvetica-Bold").text(contact.name || "Candidate", { align: "center" });
      doc.moveDown(0.5);
      
      const contactInfo = [contact.email, contact.phone, contact.location, contact.linkedin].filter(Boolean).join(" | ");
      doc.fontSize(10).font("Helvetica").text(contactInfo, { align: "center" });
      doc.moveDown(1.5);

      // Summary
      if (summary) {
        doc.fontSize(12).font("Helvetica-Bold").text("PROFESSIONAL SUMMARY");
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica").text(summary, { align: "justify" });
        doc.moveDown(1);
      }

      // Experience
      if (experience.length > 0) {
        doc.fontSize(12).font("Helvetica-Bold").text("WORK EXPERIENCE");
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);

        experience.forEach((exp) => {
          doc.fontSize(11).font("Helvetica-Bold").text(exp.title || "", { continued: true });
          doc.font("Helvetica").text(\` | \${exp.company || ""}\`);
          
          const dates = [exp.startDate, exp.endDate].filter(Boolean).join(" - ");
          if (dates) {
            doc.fontSize(10).font("Helvetica-Oblique").text(dates);
          }
          doc.moveDown(0.2);

          (exp.bullets || []).forEach((bullet) => {
            doc.fontSize(10).font("Helvetica").text(\`• \${bullet}\`, { indent: 15, align: "justify" });
          });
          doc.moveDown(0.8);
        });
      }

      // Skills
      if (Object.keys(skills).length > 0) {
        doc.fontSize(12).font("Helvetica-Bold").text("SKILLS");
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);

        for (const [category, skillList] of Object.entries(skills)) {
          if (Array.isArray(skillList) && skillList.length > 0) {
            doc.fontSize(10).font("Helvetica-Bold").text(\`\${category}: \`, { continued: true });
            doc.font("Helvetica").text(skillList.join(", "));
          }
        }
        doc.moveDown(1);
      }

      // Education
      if (education.length > 0) {
        doc.fontSize(12).font("Helvetica-Bold").text("EDUCATION");
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);

        education.forEach((edu) => {
          doc.fontSize(11).font("Helvetica-Bold").text(\`\${edu.degree || ""} \${edu.field ? "in " + edu.field : ""}\`);
          doc.fontSize(10).font("Helvetica").text(edu.institution || "");
          const dates = [edu.startDate, edu.endDate].filter(Boolean).join(" - ");
          if (dates) {
            doc.font("Helvetica-Oblique").text(dates);
          }
          doc.moveDown(0.5);
        });
      }

      doc.end();
    } catch (err) {
      logger.error("Failed to generate PDF", { error: err.message });
      reject(new AppError("Failed to generate PDF document", 500));
    }
  });
}

/**
 * Generates an ATS-friendly DOCX from optimized resume JSON.
 * @param {object} optimizedJson - The AI generated resume JSON
 * @returns {Promise<Buffer>} The DOCX buffer
 */
export async function generateDocx(optimizedJson) {
  try {
    const { contact = {}, summary = "", experience = [], education = [], skills = {} } = optimizedJson;

    const sections = [];

    // Header
    sections.push(
      new Paragraph({
        text: contact.name || "Candidate",
        heading: HeadingLevel.HEADING_1,
        alignment: "center",
      })
    );

    const contactInfo = [contact.email, contact.phone, contact.location, contact.linkedin].filter(Boolean).join(" | ");
    sections.push(
      new Paragraph({
        text: contactInfo,
        alignment: "center",
      })
    );

    // Summary
    if (summary) {
      sections.push(new Paragraph({ text: "PROFESSIONAL SUMMARY", heading: HeadingLevel.HEADING_2 }));
      sections.push(new Paragraph({ text: summary }));
    }

    // Experience
    if (experience.length > 0) {
      sections.push(new Paragraph({ text: "WORK EXPERIENCE", heading: HeadingLevel.HEADING_2 }));
      experience.forEach((exp) => {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: exp.title || "", bold: true }),
              new TextRun({ text: \` | \${exp.company || ""}\` }),
            ],
          })
        );
        const dates = [exp.startDate, exp.endDate].filter(Boolean).join(" - ");
        if (dates) {
          sections.push(new Paragraph({ text: dates, italics: true }));
        }
        (exp.bullets || []).forEach((bullet) => {
          sections.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
        });
      });
    }

    // Skills
    if (Object.keys(skills).length > 0) {
      sections.push(new Paragraph({ text: "SKILLS", heading: HeadingLevel.HEADING_2 }));
      for (const [category, skillList] of Object.entries(skills)) {
        if (Array.isArray(skillList) && skillList.length > 0) {
          sections.push(
            new Paragraph({
              children: [
                new TextRun({ text: \`\${category}: \`, bold: true }),
                new TextRun({ text: skillList.join(", ") }),
              ],
            })
          );
        }
      }
    }

    // Education
    if (education.length > 0) {
      sections.push(new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }));
      education.forEach((edu) => {
        sections.push(
          new Paragraph({
            text: \`\${edu.degree || ""} \${edu.field ? "in " + edu.field : ""}\`,
            bold: true,
          })
        );
        sections.push(new Paragraph({ text: edu.institution || "" }));
        const dates = [edu.startDate, edu.endDate].filter(Boolean).join(" - ");
        if (dates) {
          sections.push(new Paragraph({ text: dates, italics: true }));
        }
      });
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: sections,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  } catch (err) {
    logger.error("Failed to generate DOCX", { error: err.message });
    throw new AppError("Failed to generate DOCX document", 500);
  }
}
