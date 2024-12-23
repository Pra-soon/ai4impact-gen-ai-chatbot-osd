import { AdminDataType } from "../../common/types";
import { DateTime } from "luxon";
import { Utils } from "../../common/utils";
import { useNavigate } from 'react-router-dom';
import { Button } from "@cloudscape-design/components";


export function getColumnDefinition(documentType: AdminDataType, onProblemClick: (item: any) => void) {
  const FEEDBACK_COLUMN_DEFINITIONS = [
    {
      id: "problem",
      header: "Problem",
      cell: (item) => {
        return (
          <Button onClick={() => onProblemClick(item)} variant="link">
            {item.Problem}
          </Button>
        );
      },
      isRowHeader: true,
    },
    {
      id: "topic",
      header: "Topic",
      cell: (item) => item.Topic,
      isRowHeader: true,
    },
    {
      id: "createdAt",
      header: "Submission date",
      cell: (item) =>
        DateTime.fromISO(new Date(item.CreatedAt).toISOString()).toLocaleString(
          DateTime.DATETIME_SHORT
        ),
    },
    {
      id: "prompt",
      header: "User Prompt",
      cell: (item) => item.UserPrompt,
      isRowHeader: true
    },
  ];

  const FILES_COLUMN_DEFINITIONS = [
    {
      id: "name",
      header: "Name",
      cell: (item) => item.Key!,
      isRowHeader: true,
    },
    {
      id: "createdAt",
      header: "Upload date",
      cell: (item) =>
        DateTime.fromISO(new Date(item.LastModified).toISOString()).toLocaleString(
          DateTime.DATETIME_SHORT
        ),
    },
    {
      id: "size",
      header: "Size",
      cell: (item) => Utils.bytesToSize(item.Size!),
    },
  ];

  // Return appropriate column definitions based on document type
  switch (documentType) {
    case "file":
      return FILES_COLUMN_DEFINITIONS;
    case "feedback":
      return FEEDBACK_COLUMN_DEFINITIONS;
    default:
      return [];
  }
}



// const FILES_COLUMN_DEFINITIONS = [
//   {
//     id: "name",
//     header: "Name",
//     cell: (item) => item.Key!,
//     isRowHeader: true,
//   },
//   {
//     id: "createdAt",
//     header: "Upload date",
//     cell: (item) =>
//       DateTime.fromISO(new Date(item.LastModified).toISOString()).toLocaleString(
//         DateTime.DATETIME_SHORT
//       ),
//   },
//   {
//     id: "size",
//     header: "Size",
//     cell: (item) => Utils.bytesToSize(item.Size!),
//   },
// ];

// const FEEDBACK_COLUMN_DEFINITIONS = [
//   {
//     id: "problem",
//     header: "Problem",
//     // cell: (item) => item.Problem,
//     cell: (item) => {
//       return (
//         <Button onClick={() => onProblemClick(item)} variant="link">
//           {item.Problem}
//         </Button>
//       );
//     },
//     isRowHeader: true,
//   },
//   {
//     id: "topic",
//     header: "Topic",
//     cell: (item) => item.Topic,
//     isRowHeader: true,
//   },
//   {
//     id: "createdAt",
//     header: "Submission date",
//     cell: (item) =>
//       DateTime.fromISO(new Date(item.CreatedAt).toISOString()).toLocaleString(
//         DateTime.DATETIME_SHORT
//       ),
//   },
//   {
//     id: "prompt",
//     header: "User Prompt",
//     cell: (item) => item.UserPrompt,
//     isRowHeader: true
//   },

// ];

// /** This is exposed as a function because the code that this is based off of
//  * originally supported many more distinct file types.
//  */
// export function getColumnDefinition(documentType: AdminDataType, onProblemClick: (item: any) => void) {
//   switch (documentType) {
//     case "file":
//       return FILES_COLUMN_DEFINITIONS;   
//     case "feedback":
//       return FEEDBACK_COLUMN_DEFINITIONS;
//     default:
//       return [];
//   }
// }
